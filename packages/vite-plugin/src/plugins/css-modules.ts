import type { Plugin } from 'vite'
import type { ResolvedMahoPluginOptions } from '../types'

/**
 * CSS Modules 配置插件。
 *
 * 设计澄清（详见 docs/design-optimizations.md）：
 * 原设计文档措辞是「强制开启 CSS Modules」，但 Vite 默认对
 * `*.module.css` 自动应用 CSS Modules，强制对所有 css 文件开启
 * 反而会破坏全局样式（如 reset.css）。
 *
 * 因此此插件的真实职责是：统一 scopedName 命名规则，确保各子包产物
 * 的 CSS 类名格式一致 + 防止全局类名冲突。
 *
 * 默认 scopedName：`[local]__[hash:base64:5]`
 */
export function mahoCSSModulesPlugin(
  options: ResolvedMahoPluginOptions,
): Plugin {
  return {
    name: 'maho:css-modules',
    enforce: 'pre',
    config() {
      if (options.cssModules.disabled) return
      return {
        css: {
          modules: {
            generateScopedName: options.cssModules.generateScopedName,
          },
        },
      }
    },
  }
}
