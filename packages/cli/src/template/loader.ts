import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MahoError } from '../utils/errors'

export interface MahoTemplateMeta {
  name: string
  description: string
  role: 'host' | 'remote'
  framework: 'vue'
}

export interface MahoTemplate {
  meta: MahoTemplateMeta
  /** 模板文件根目录的绝对路径（含 template/ 子目录） */
  templateDir: string
}

const BUILT_IN_META: Record<string, MahoTemplateMeta> = {
  'host-vue': {
    name: 'host-vue',
    description: 'Vue 3 host workspace with router and layouts',
    role: 'host',
    framework: 'vue',
  },
  'remote-vue': {
    name: 'remote-vue',
    description: 'Vue 3 remote module with mf-routes',
    role: 'remote',
    framework: 'vue',
  },
}

export function listBuiltinTemplates(): string[] {
  return Object.keys(BUILT_IN_META)
}

/**
 * 加载模板。Step 5 仅支持内置模板名；本地路径和 npm 包推迟。
 */
export function loadTemplate(source: string): MahoTemplate {
  if (BUILT_IN_META[source]) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const templateDir = path.resolve(__dirname, `../template/built-in/${source}/template`)
    return {
      meta: BUILT_IN_META[source],
      templateDir,
    }
  }

  throw new MahoError(
    'template-not-found',
    `Template "${source}" not found. Available built-in templates: ${Object.keys(BUILT_IN_META).join(', ')}.`,
  )
}
