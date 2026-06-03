# Maho CLI 详细设计

> 本文档涵盖：CLI 整体结构、命令设计（init / add / dev / build）、模板系统、工作区探测、进程管理、包管理器适配。

---

## 目录

1. [整体结构](#整体结构)
2. [工作区探测](#工作区探测)
3. [包管理器适配](#包管理器适配)
4. [maho init](#maho-init)
5. [maho add](#maho-add)
6. [maho dev](#maho-dev)
7. [maho build](#maho-build)
8. [模板系统](#模板系统)
9. [进程管理器](#进程管理器)
10. [错误处理与日志](#错误处理与日志)

---

## 整体结构

```
@maho/cli
  bin/
    maho.js              CLI 入口，解析命令并路由到对应 command
  src/
    commands/
      init.ts            maho init
      add.ts             maho add
      dev.ts             maho dev
      build.ts           maho build
    core/
      context.ts         WorkspaceContext：探测工作区结构
      detector.ts        包管理器、仓库类型检测
      process-manager.ts 多进程启动与管理（dev 命令使用）
      port-manager.ts    端口自动分配与冲突检测
    template/
      loader.ts          模板加载器（内置 / 本地 / npm）
      renderer.ts        EJS 模板渲染 + 文件写入
      built-in/          内置模板目录
        host-vue/
        remote-vue/
        host-react/
        remote-react/
    utils/
      logger.ts          带前缀的彩色日志输出
      prompt.ts          交互式问答封装
      fs.ts              文件操作工具
```

### 命令路由

```
maho <command> [options]

  init   [name]            初始化新项目
  add    [name]            新建子包
  dev                      启动开发环境
  build                    构建当前包或所有包
```

---

## 工作区探测

`WorkspaceContext` 是所有命令的运行基础，负责探测当前目录所在的工作区结构。

```ts
// @maho/cli/src/core/context.ts

interface WorkspaceContext {
  // 工作区根目录（包含 config/config.yml 的最近祖先目录）
  root:        string

  // 当前命令执行的目录
  cwd:         string

  // 当前目录对应的角色（host / remote / unknown）
  role:        'host' | 'remote' | 'unknown'

  // 是否在 apps/* 子包中（polyrepo 时始终为 false）
  isInApp:     boolean

  // 已发现的所有子包信息
  apps:        AppInfo[]

  // 包管理器
  packageManager: PackageManager

  // 已解析的配置（若存在）
  config?:     ResolvedMFConfig
}

interface AppInfo {
  name:    string   // 模块名（来自 config.yml 的 name 字段或目录名）
  dir:     string   // 绝对路径
  role:    'remote'
  hasConfig: boolean
}

async function resolveContext(cwd = process.cwd()): Promise<WorkspaceContext> {
  // 1. 向上查找工作区根目录
  const root = findWorkspaceRoot(cwd)

  // 2. 确定当前目录角色
  const role = detectRole(cwd, root)

  // 3. 扫描 apps/* 子包
  const apps = await scanApps(root)

  // 4. 检测包管理器
  const packageManager = detectPackageManager(root)

  return { root, cwd, role, isInApp: role === 'remote', apps, packageManager }
}

function findWorkspaceRoot(cwd: string): string {
  let dir = cwd
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'config', 'config.yml'))) return dir
    dir = path.dirname(dir)
  }
  throw new MahoError(
    'workspace-not-found',
    'No maho workspace found. Run "maho init" to create one.',
  )
}

function detectRole(cwd: string, root: string): 'host' | 'remote' | 'unknown' {
  if (cwd === root) return 'host'
  // 检查是否在 apps/* 下
  const appsDir = path.join(root, 'apps')
  if (cwd.startsWith(appsDir + path.sep)) return 'remote'
  return 'unknown'
}

async function scanApps(root: string): Promise<AppInfo[]> {
  const appsDir = path.join(root, 'apps')
  if (!fs.existsSync(appsDir)) return []

  const dirs = fs.readdirSync(appsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(appsDir, d.name))

  return dirs.map(dir => {
    const configPath  = path.join(dir, 'config', 'config.yml')
    const hasConfig   = fs.existsSync(configPath)
    const name        = hasConfig
      ? (readYamlSync(configPath)?.name ?? path.basename(dir))
      : path.basename(dir)

    return { name, dir, role: 'remote' as const, hasConfig }
  })
}
```

---

## 包管理器适配

```ts
// @maho/cli/src/core/detector.ts

type PackageManager = 'pnpm' | 'npm' | 'yarn'

function detectPackageManager(root: string): PackageManager {
  // 1. lockfile 优先级最高（最准确）
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml')))    return 'pnpm'
  if (fs.existsSync(path.join(root, 'yarn.lock')))          return 'yarn'
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm'

  // 2. 通过 npm_config_user_agent 判断当前运行环境
  const agent = process.env.npm_config_user_agent ?? ''
  if (agent.startsWith('pnpm')) return 'pnpm'
  if (agent.startsWith('yarn')) return 'yarn'

  // 3. 默认 npm
  return 'npm'
}

// 统一的安装命令生成
function installCommand(pm: PackageManager, packages: string[]): string {
  const pkgList = packages.join(' ')
  switch (pm) {
    case 'pnpm': return `pnpm add ${pkgList}`
    case 'yarn': return `yarn add ${pkgList}`
    case 'npm':  return `npm install ${pkgList}`
  }
}

// 执行安装
async function runInstall(
  pm:       PackageManager,
  packages: string[],
  cwd:      string,
): Promise<void> {
  const cmd = installCommand(pm, packages)
  logger.info(`Running: ${cmd}`)
  await execa(pm, ['add', ...packages], { cwd, stdio: 'inherit' })
}
```

---

## `maho init`

### 功能

初始化一个全新的 Maho 工作区（Host 项目），生成完整目录结构并安装依赖。

### 交互流程

```
$ maho init my-app

┌ Maho — 初始化项目
│
◇ 框架选择
│  ● Vue 3    ○ React 18
│
◇ 包管理器  (已检测到 pnpm)
│  ● pnpm    ○ npm    ○ yarn
│
◇ 是否立即创建第一个子包？
│  ● 是    ○ 否
│
◇ 子包名称
│  module-home
│
└ 正在初始化...

✓ 创建目录结构
✓ 生成配置文件
✓ 生成模板文件
✓ 安装依赖 (pnpm install)

  🎉 my-app 已创建！

  下一步：
    cd my-app
    maho dev
```

### 生成的目录结构

```
my-app/
  config/
    config.yml
    config.dev.yml
    config.prod.yml
  src/
    App.vue              ← AppShell 根组件
    app.ts               ← createMahoApp 入口
    layouts/
      DefaultLayout.vue
      BlankLayout.vue
  plugins/               ← 空目录，用于本地 TS 插件
  apps/
    module-home/         ← 若用户选择立即创建子包
      config/config.yml
      src/
        mf-routes.ts
        pages/
          Home.vue
      package.json
  public/
  index.html
  package.json
  pnpm-workspace.yaml    ← 仅 pnpm
  tsconfig.json
  .gitignore
  .env
  .env.dev
```

### 命令实现

```ts
// @maho/cli/src/commands/init.ts

export async function init(projectName?: string) {
  // 1. 收集用户输入
  const answers = await prompt([
    {
      name:    'name',
      message: '项目名称',
      default: projectName ?? 'my-app',
    },
    {
      name:    'framework',
      type:    'select',
      message: '框架选择',
      options: ['vue', 'react'],
    },
    {
      name:    'packageManager',
      type:    'select',
      message: '包管理器',
      options: ['pnpm', 'npm', 'yarn'],
      default: detectPackageManager(process.cwd()),
    },
    {
      name:    'createFirstApp',
      type:    'confirm',
      message: '是否立即创建第一个子包？',
      default: true,
    },
    {
      name:    'firstAppName',
      message: '子包名称',
      when:    (a) => a.createFirstApp,
      default: 'module-home',
    },
  ])

  const { name, framework, packageManager, createFirstApp, firstAppName } = answers
  const targetDir = path.resolve(process.cwd(), name)

  // 2. 检查目录是否已存在
  if (fs.existsSync(targetDir)) {
    throw new MahoError('dir-exists', `Directory "${name}" already exists.`)
  }

  // 3. 加载模板并渲染
  const template = await loadTemplate(`host-${framework}`)
  await renderTemplate(template, targetDir, {
    projectName:    name,
    framework,
    packageManager,
  })

  // 4. 如果要创建子包，调用 add 逻辑
  if (createFirstApp) {
    await addApp({
      name:      firstAppName,
      framework,
      targetDir: path.join(targetDir, 'apps', firstAppName),
      register:  true,   // 自动注册到 pnpm-workspace.yaml
    })
  }

  // 5. 安装依赖
  logger.step('安装依赖...')
  await runInstall(packageManager, [], targetDir)

  // 6. 输出完成信息
  logger.success(`\n🎉 ${name} 已创建！\n`)
  logger.info(`下一步：\n  cd ${name}\n  maho dev`)
}
```

---

## `maho add`

### 功能

在已有工作区中新建一个 Remote 子包，自动注册到 workspace 并更新 `config.yml`。

### 交互流程

```
$ maho add

◇ 子包名称
│  module-order

◇ 路由前缀  (默认 /module-order)
│  /order

◇ 使用哪个模板？
│  ● Vue (内置)
│  ○ React (内置)
│  ○ custom-remote (自定义)

✓ 创建 apps/module-order/
✓ 注册到 pnpm-workspace.yaml
✓ 安装依赖

  ✨ module-order 已添加！运行 maho dev --filter module-order 启动。
```

### 生成的子包结构

```
apps/module-order/
  config/
    config.yml
    config.dev.yml
  src/
    mf-routes.ts          ← 路由声明
    pages/
      OrderList.vue
    components/
    utils/
  package.json
  tsconfig.json
```

### 生成的 `config.yml`

```yaml
role: remote
name: module-order
prefix: /order

exposes:
  - ./pages/OrderList

plugins:
  - use: "@maho/plugin-routes"
  - use: "@maho/plugin-types"
```

### 命令实现

```ts
// @maho/cli/src/commands/add.ts

export async function add(appName?: string) {
  const ctx = await resolveContext()

  // 必须在工作区根目录执行
  if (ctx.role !== 'host') {
    throw new MahoError(
      'wrong-directory',
      'Run "maho add" from the workspace root.',
    )
  }

  const answers = await prompt([
    {
      name:    'name',
      message: '子包名称',
      default: appName,
      validate: (v) => {
        if (ctx.apps.some(a => a.name === v)) return `"${v}" already exists`
        return true
      },
    },
    {
      name:    'prefix',
      message: '路由前缀',
      default: (a: any) => `/${a.name}`,
    },
    {
      name:    'template',
      type:    'select',
      message: '使用哪个模板？',
      options: await listAvailableTemplates(ctx),
    },
  ])

  const targetDir = path.join(ctx.root, 'apps', answers.name)

  // 加载并运行模板（模板可能有额外的 prompts）
  const template     = await loadTemplate(answers.template)
  const extraAnswers = await promptTemplateExtras(template)

  await renderTemplate(template, targetDir, {
    ...answers,
    ...extraAnswers,
    framework: detectFramework(ctx),
  })

  // 注册到 pnpm-workspace.yaml
  await registerWorkspace(ctx.root, `apps/${answers.name}`)

  // 安装子包依赖
  await runInstall(ctx.packageManager, [], targetDir)

  logger.success(`\n✨ ${answers.name} 已添加！`)
  logger.info(`运行 maho dev --filter ${answers.name} 启动。`)
}
```

---

## `maho dev`

### 功能

启动 Host 和选定子包的开发服务器，统一输出带前缀的日志。

### 命令选项

```
maho dev                           Host + 所有 devDefault:true 的子包
maho dev --filter order,user       Host + 指定子包（逗号分隔）
maho dev --filter all              Host + 所有子包
maho dev --host-only               只启动 Host Shell
```

### 启动流程

```ts
// @maho/cli/src/commands/dev.ts

export async function dev(options: DevOptions) {
  const ctx = await resolveContext()

  // 确定要启动的目标列表
  const targets = await resolveDevTargets(ctx, options)

  logger.info(`Starting ${targets.length} process(es)...\n`)

  // 启动进程管理器
  const manager = new ProcessManager()
  await manager.start(targets)

  // 进程全部就绪后输出访问地址
  manager.onAllReady((readyTargets) => {
    console.log()
    readyTargets.forEach(t => {
      logger.success(`${t.name.padEnd(16)} → ${t.url}`)
    })
    console.log()
  })

  // Ctrl+C 优雅退出
  process.on('SIGINT', async () => {
    logger.info('Shutting down...')
    await manager.shutdown()
    process.exit(0)
  })
}

async function resolveDevTargets(
  ctx:     WorkspaceContext,
  options: DevOptions,
): Promise<DevTarget[]> {
  const targets: DevTarget[] = []

  // Host 始终第一个
  const hostPort = await allocatePort(5173)
  targets.push({
    name:  'host',
    role:  'host',
    cwd:   ctx.root,
    port:  hostPort,
    color: 'cyan',
  })

  // 确定要附带的子包
  let appsToStart: AppInfo[] = []

  if (options.hostOnly) {
    // --host-only：不启动任何子包
  } else if (options.filter === 'all') {
    appsToStart = ctx.apps
  } else if (options.filter) {
    const names = options.filter.split(',').map(s => s.trim())
    appsToStart = ctx.apps.filter(a => names.includes(a.name))
    // 检查是否有找不到的子包名
    const missing = names.filter(n => !ctx.apps.some(a => a.name === n))
    if (missing.length) {
      logger.warn(`Apps not found: ${missing.join(', ')}`)
    }
  } else {
    // 默认：启动 config.yml 中 devDefault:true 的子包
    appsToStart = ctx.apps.filter(a => isDevDefault(a))
  }

  // 为每个子包分配端口
  let nextPort = hostPort + 1
  for (const app of appsToStart) {
    const port = await allocatePort(nextPort++)
    targets.push({
      name:  app.name,
      role:  'remote',
      cwd:   app.dir,
      port,
      color: pickColor(targets.length),
    })
  }

  // 生成 dev manifest，注入到 Host 环境变量
  injectDevManifest(targets)

  return targets
}
```

### dev manifest 注入

启动 Host 时将所有子包的本地 dev server 地址注入为环境变量，Boot 的 `virtual:maho-config` 会读取并切换 remote URL：

```ts
function injectDevManifest(targets: DevTarget[]): void {
  const remoteTargets = targets.filter(t => t.role === 'remote')

  const manifest = JSON.stringify(
    remoteTargets.map(t => ({
      name:  t.name,
      entry: `http://localhost:${t.port}/remoteEntry.js`,
    }))
  )

  // 通过环境变量传递给 Host 进程
  // ViteService 在生成 virtual:maho-config 时读取此变量
  process.env.MAHO_DEV_REMOTES = manifest
}
```

### 子包在工作区根目录执行 `maho dev` 时的行为

若在 `apps/module-order` 目录下执行 `maho dev`，框架向上查找工作区根目录，等价于在根目录执行 `maho dev --filter module-order`：

```ts
if (ctx.isInApp) {
  logger.info(`Detected remote module "${ctx.role}", delegating to workspace root...`)

  // 重新以工作区根目录为 cwd 执行
  await execa('maho', ['dev', '--filter', currentAppName], {
    cwd:   ctx.root,
    stdio: 'inherit',
  })
  return
}
```

---

## `maho build`

### 功能

按拓扑顺序构建当前包或工作区内的所有包。

### 命令选项

```
maho build                    构建当前包（按 config.yml 的 role 和 buildMode）
maho build --filter order     只构建指定子包
maho build --all              构建所有包（拓扑顺序）
maho build --mode staging     使用指定 mode 的配置
```

### 构建顺序（`--all` 时）

```
Stage 1（并行）  所有 remote 子包
                 互相独立，可以并行构建
      ↓
Stage 2（串行）  Host 包
                 依赖 remote 产物（manifest 写入后 Host 才能引用）
```

```ts
// @maho/cli/src/commands/build.ts

export async function build(options: BuildOptions) {
  const ctx = await resolveContext()

  if (options.all) {
    await buildAll(ctx, options)
  } else if (options.filter) {
    await buildFiltered(ctx, options.filter, options)
  } else {
    await buildCurrent(ctx, options)
  }
}

async function buildAll(ctx: WorkspaceContext, options: BuildOptions) {
  // Stage 1：并行构建所有 remote 子包
  logger.step('Building remotes...')
  const remoteResults = await Promise.allSettled(
    ctx.apps.map(app => buildPackage(app.dir, options))
  )

  // 收集失败的子包，但不阻断 Host 构建
  const failures = remoteResults
    .map((r, i) => ({ result: r, app: ctx.apps[i] }))
    .filter(({ result }) => result.status === 'rejected')

  if (failures.length) {
    failures.forEach(({ result, app }) => {
      logger.error(`Failed to build "${app.name}": ${(result as any).reason}`)
    })
  }

  // Stage 2：构建 Host
  logger.step('Building host...')
  await buildPackage(ctx.root, options)

  // 输出构建摘要
  const success = ctx.apps.length - failures.length
  logger.success(
    `\nBuild complete: ${success}/${ctx.apps.length} remotes + host\n`
  )
}

async function buildPackage(cwd: string, options: BuildOptions): Promise<void> {
  const mode = options.mode ?? 'prod'

  await execa('node', [
    '--import', 'tsx/esm',
    require.resolve('@maho/core/build-runner'),
    '--mode', mode,
  ], {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      MAHO_BUILD_MODE: mode,
    },
  })
}
```

---

## 模板系统

### 模板来源

| 来源 | 声明方式 | 示例 |
|---|---|---|
| 内置模板 | 模板名 | `host-vue`、`remote-react` |
| 本地路径 | 相对路径 | `./templates/my-remote` |
| npm 包 | 包名 | `@org/maho-template-custom` |

自定义模板在 Host 的 `config.yml` 中注册：

```yaml
templates:
  custom-remote: "./templates/custom-remote"
  org-host:      "@org/maho-template-host"
```

### 模板包结构

```
maho-template-custom-remote/
  package.json
  index.js              导出模板元信息和生命周期钩子
  template/             模板文件（EJS 语法）
    config/
      config.yml.ejs
      config.dev.yml.ejs
    src/
      mf-routes.ts.ejs
      pages/
        Index.vue.ejs
    package.json.ejs
    tsconfig.json.ejs
```

### 模板接口

```ts
// 每个模板包必须导出的接口
interface MahoTemplate {
  // 模板元信息
  meta: {
    name:        string
    description: string
    role:        'host' | 'remote'
    framework:   'vue' | 'react' | 'any'
  }

  // 额外的交互问题（追加在框架默认问题之后）
  prompts?: PromptQuestion[]

  // 对收集到的所有答案进行最终处理，返回传入 EJS 的模板变量
  transform?: (answers: Record<string, unknown>) => Record<string, unknown>

  // 模板渲染完成后执行的操作（安装额外依赖等）
  postInstall?: (targetDir: string, answers: Record<string, unknown>) => Promise<void>
}
```

### 模板加载器

```ts
// @maho/cli/src/template/loader.ts

async function loadTemplate(source: string): Promise<MahoTemplate> {
  // 1. 内置模板名
  const builtIn = BUILT_IN_TEMPLATES.get(source)
  if (builtIn) return builtIn

  // 2. 本地路径（./ 或 / 开头）
  if (source.startsWith('.') || path.isAbsolute(source)) {
    const absPath = path.resolve(process.cwd(), source)
    return importTemplate(absPath)
  }

  // 3. npm 包
  try {
    const pkgPath = require.resolve(source + '/index.js', {
      paths: [process.cwd()],
    })
    return importTemplate(pkgPath)
  } catch {
    throw new MahoError(
      'template-not-found',
      `Template "${source}" not found. Install it with:\n` +
      `  ${installCommand(detectPackageManager(process.cwd()), [source])}`,
    )
  }
}

async function importTemplate(filePath: string): Promise<MahoTemplate> {
  // 支持 .ts 模板入口文件（通过 jiti 编译）
  const jiti = createJiti(process.cwd())
  const mod  = await jiti.import(filePath)
  const tmpl = mod.default ?? mod

  // 验证模板接口
  if (!tmpl.meta?.name) {
    throw new MahoError('invalid-template', `Template at "${filePath}" is missing "meta.name"`)
  }
  return tmpl
}
```

### 模板渲染器

```ts
// @maho/cli/src/template/renderer.ts

async function renderTemplate(
  template:  MahoTemplate,
  targetDir: string,
  answers:   Record<string, unknown>,
): Promise<void> {

  // 1. transform 处理模板变量
  const vars = template.transform
    ? template.transform(answers)
    : answers

  // 2. 遍历 template/ 目录，渲染每个文件
  const templateDir = path.join(path.dirname(template.__filePath), 'template')
  await renderDir(templateDir, targetDir, vars)

  // 3. 执行 postInstall
  if (template.postInstall) {
    await template.postInstall(targetDir, answers)
  }
}

async function renderDir(
  srcDir:    string,
  destDir:   string,
  vars:      Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true })

  const entries = fs.readdirSync(srcDir, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath  = path.join(srcDir,  entry.name)
    const destName = entry.name.replace(/\.ejs$/, '')
    const destPath = path.join(destDir, destName)

    if (entry.isDirectory()) {
      await renderDir(srcPath, destPath, vars)
    } else if (entry.name.endsWith('.ejs')) {
      const content  = fs.readFileSync(srcPath, 'utf-8')
      const rendered = ejs.render(content, vars)
      await fs.writeFile(destPath, rendered, 'utf-8')
    } else {
      // 非 EJS 文件直接复制
      await fs.copyFile(srcPath, destPath)
    }
  }
}
```

### 内置模板清单

| 模板名 | 适用场景 | 框架 |
|---|---|---|
| `host-vue` | 新建 Vue Host 工作区 | Vue 3 |
| `remote-vue` | 新建 Vue Remote 子包 | Vue 3 |
| `host-react` | 新建 React Host 工作区 | React 18 |
| `remote-react` | 新建 React Remote 子包 | React 18 |

---

## 进程管理器

### 设计目标

- 并行启动多个进程，各进程输出带颜色前缀
- 所有进程就绪后触发 `onAllReady` 回调
- 某个进程崩溃时 `warn` 提示，不影响其他进程
- Ctrl+C 时优雅关闭所有进程

### 实现

```ts
// @maho/cli/src/core/process-manager.ts

interface DevTarget {
  name:  string
  role:  'host' | 'remote'
  cwd:   string
  port:  number
  color: ChalkColor
}

interface ReadyTarget extends DevTarget {
  url: string
}

class ProcessManager {
  private processes  = new Map<string, ChildProcess>()
  private readySet   = new Set<string>()
  private readyURLs  = new Map<string, string>()
  private allReady?:  (targets: ReadyTarget[]) => void

  onAllReady(cb: (targets: ReadyTarget[]) => void) {
    this.allReady = cb
  }

  async start(targets: DevTarget[]): Promise<void> {
    await Promise.all(targets.map(t => this.startOne(t)))
  }

  private async startOne(target: DevTarget): Promise<void> {
    const proc = spawn(
      'node',
      [
        '--import', 'tsx/esm',
        require.resolve('@maho/core/dev-runner'),
        '--port', String(target.port),
        '--mode', 'dev',
      ],
      {
        cwd: target.cwd,
        env: {
          ...process.env,
          FORCE_COLOR: '1',
        },
      }
    )

    this.processes.set(target.name, proc)

    // 带前缀的日志输出
    const prefix = chalk[target.color](`[${target.name}]`.padEnd(18))
    proc.stdout?.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      lines.forEach((line: string) => {
        process.stdout.write(`${prefix} ${line}\n`)

        // 检测 "ready" 信号
        const urlMatch = line.match(/Local:\s+(https?:\/\/\S+)/)
        if (urlMatch) {
          this.markReady(target, urlMatch[1])
        }
      })
    })

    proc.stderr?.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(Boolean)
      lines.forEach((line: string) => {
        process.stderr.write(`${prefix} ${chalk.red(line)}\n`)
      })
    })

    proc.on('exit', (code) => {
      if (code !== 0) {
        logger.warn(`Process "${target.name}" exited with code ${code}`)
        this.processes.delete(target.name)
      }
    })
  }

  private markReady(target: DevTarget, url: string): void {
    this.readySet.add(target.name)
    this.readyURLs.set(target.name, url)

    if (this.readySet.size === this.processes.size) {
      const readyTargets: ReadyTarget[] = [...this.processes.keys()].map(name => ({
        ...this.getTarget(name)!,
        url: this.readyURLs.get(name)!,
      }))
      this.allReady?.(readyTargets)
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.processes.values()].map(proc =>
        new Promise<void>(resolve => {
          proc.on('exit', () => resolve())
          proc.kill('SIGTERM')
        })
      )
    )
  }
}
```

### 端口分配

```ts
// @maho/cli/src/core/port-manager.ts

import { createServer } from 'net'

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
    server.on('error', () => resolve(false))
  })
}

async function allocatePort(preferred: number): Promise<number> {
  let port = preferred
  while (port < preferred + 20) {
    if (await isPortAvailable(port)) return port
    port++
  }
  throw new MahoError('no-port', `No available port in range ${preferred}–${port}`)
}
```

---

## 错误处理与日志

### 错误类型

```ts
// @maho/cli/src/utils/errors.ts

type MahoErrorCode =
  | 'workspace-not-found'
  | 'wrong-directory'
  | 'dir-exists'
  | 'template-not-found'
  | 'invalid-template'
  | 'no-port'
  | 'config-invalid'

class MahoError extends Error {
  constructor(
    public code:    MahoErrorCode,
    public message: string,
  ) {
    super(message)
    this.name = 'MahoError'
  }
}

// 顶层错误捕获（bin/maho.js）
process.on('uncaughtException', (err) => {
  if (err instanceof MahoError) {
    logger.error(`\n${err.message}\n`)
    process.exit(1)
  }
  // 非预期错误：打印完整 stack
  console.error(err)
  process.exit(1)
})
```

### 日志工具

```ts
// @maho/cli/src/utils/logger.ts

const logger = {
  info:    (msg: string) => console.log(chalk.gray(msg)),
  step:    (msg: string) => console.log(chalk.cyan(`▶ ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`✓ ${msg}`)),
  warn:    (msg: string) => console.log(chalk.yellow(`⚠ ${msg}`)),
  error:   (msg: string) => console.error(chalk.red(`✗ ${msg}`)),
}
```

### 输出示例

```
$ maho dev --filter order,user

▶ Starting 3 process(es)...

[host]             ▶ VITE v5.4.0 ready
[host]             ✓ Local:   http://localhost:5173/
[module-order]     ▶ VITE v5.4.0 ready
[module-order]     ✓ Local:   http://localhost:5174/
[module-user]      ▶ VITE v5.4.0 ready
[module-user]      ✓ Local:   http://localhost:5175/

  host             → http://localhost:5173/
  module-order     → http://localhost:5174/
  module-user      → http://localhost:5175/

[module-order]     hmr update /src/pages/OrderList.vue
```

---

*下一篇：[design-federation.md](./design-federation.md) — remoteEntry 协议、manifest 管理、共享依赖*
