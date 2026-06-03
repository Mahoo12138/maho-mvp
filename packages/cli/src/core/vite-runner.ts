import {
  build as viteBuild,
  createServer,
  preview as vitePreview,
  type Plugin,
  type PreviewServer,
} from 'vite'
import { createMahoContext, type MFContext } from '@maho/core'
import { maho, type MahoPluginOptions } from '@maho/vite-plugin'

export interface ViteTarget {
  /** 工作区里的逻辑名（'host' 或 remote app 名） */
  name: string
  role: 'host' | 'remote'
  /** 该 app 的根目录（包含 config/config.yml + index.html / src） */
  cwd: string
  /** dev mode：vite server 端口 */
  port?: number
  /** dev mode：host 注入的 MAHO_DEV_REMOTES（每个 remote 不需要） */
  devRemotes?: Record<string, string>
}

export interface DevServerHandle {
  url: string
  close: () => Promise<void>
}

/**
 * 加载该 app 的 MFContext（含 BootService），并基于 config + boot 适配器
 * 拼装出 vite 插件列表。
 *
 * - boot.getVitePlugins() 提供框架级插件（vue / react / solid 的 transform）
 * - maho() 提供 federation / loading / type-registry / virtual-config
 */
async function buildPluginStack(
  target: ViteTarget,
  mode: string,
): Promise<{ ctx: MFContext; plugins: Plugin[] }> {
  const ctx = await createMahoContext({ projectRoot: target.cwd, mode })

  if (!ctx.boot) {
    throw new Error(
      `[Maho] config/config.yml in "${target.cwd}" missing required "boot" field ` +
        `(e.g. boot: "@maho/boot-vue").`,
    )
  }

  const resolved = ctx.config.resolved

  // BootService already loaded sharedDeps — pass them directly to vite-plugin
  // and DO NOT set bootAdapter (which would trigger vite-plugin's own dynamic
  // import of the boot pkg from inside vite-plugin's dir, where the pkg can't
  // be resolved).
  const mergedShared: MahoPluginOptions['shared'] = {
    ...(ctx.boot.sharedDeps as MahoPluginOptions['shared']),
    ...((resolved.shared as MahoPluginOptions['shared']) ?? {}),
  }

  const opts: MahoPluginOptions = {
    role: target.role,
    name: resolved.name ?? target.name,
    mode,
    federation: {
      remotes: resolved.federation?.remotes,
      manifestUrl: resolved.federation?.manifestUrl ?? null,
      devRemotes: target.devRemotes,
    },
    exposes: Array.isArray(resolved.exposes) ? resolved.exposes : undefined,
    shared: mergedShared,
    loading: resolved.loading,
    projectRoot: target.cwd,
  }

  const bootPlugins = (await ctx.boot.getVitePlugins()) as unknown as Plugin[]
  const mahoPlugins = await maho(opts)

  return { ctx, plugins: [...bootPlugins, ...mahoPlugins] }
}

/**
 * Host：标准 vite dev server，提供 HMR + 即时模块替换。
 */
export async function startHostDevServer(
  target: ViteTarget,
): Promise<DevServerHandle> {
  if (target.port === undefined) {
    throw new Error(`[Maho] startHostDevServer requires target.port`)
  }

  const { plugins } = await buildPluginStack(target, 'dev')

  const server = await createServer({
    root: target.cwd,
    configFile: false,
    plugins,
    server: {
      port: target.port,
      strictPort: true,
      host: '127.0.0.1',
    },
    appType: 'spa',
  })

  await server.listen()
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${target.port}/`
  return { url, close: () => server.close() }
}

/**
 * Remote：build + preview。
 *
 * `@originjs/vite-plugin-federation` 在 dev 模式下不输出 `remoteEntry.js`
 * （联邦元数据只在 Rollup 阶段生成），host 拉不到入口 → 卡 loading。
 * 解决：先一次性 build 到 dist/，再用 vite preview 静态托管。
 * 代价：remote 失去 HMR；改 remote 源码后需重启 `maho dev`。V2 通过
 * `vite.build({ build: { watch: {} } })` + 文件监听重启 preview 来解决。
 */
export async function startRemotePreviewServer(
  target: ViteTarget,
): Promise<DevServerHandle> {
  if (target.port === undefined) {
    throw new Error(`[Maho] startRemotePreviewServer requires target.port`)
  }

  // mode 仍为 'dev' —— vite-plugin 的 virtual-config 用此判断
  // 是否注入 devRemotes；remote 自身不消费 devRemotes 但保持语义一致。
  const { plugins } = await buildPluginStack(target, 'dev')

  await viteBuild({
    root: target.cwd,
    configFile: false,
    plugins,
    // 设置 base 为 remote 自身的完整 URL，使 Vite 生成的 chunk
    // 引用（如 /assets/Home-xxx.js）被解析到 remote 的端口上，
    // 而非 host 页面所在的 origin。详见 S4-O15。
    base: `http://127.0.0.1:${target.port}/`,
    mode: 'development',
    logLevel: 'warn',
    build: {
      minify: false,
      sourcemap: true,
      target: 'esnext',
    },
  })

  const previewServer: PreviewServer = await vitePreview({
    root: target.cwd,
    configFile: false,
    preview: {
      port: target.port,
      strictPort: true,
      host: '127.0.0.1',
      cors: true,
    },
  })

  const url = previewServer.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${target.port}/`
  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        previewServer.httpServer.close(() => resolve())
      }),
  }
}

/**
 * 跑一次 vite build。失败抛错，由调用方决定退出策略。
 */
export async function runBuild(
  target: ViteTarget,
  mode: string,
): Promise<void> {
  const { plugins } = await buildPluginStack(target, mode)

  await viteBuild({
    root: target.cwd,
    configFile: false,
    plugins,
    mode,
    logLevel: 'info',
    build: {
      target: 'esnext',
      minify: false,
      sourcemap: true,
    },
  })
}
