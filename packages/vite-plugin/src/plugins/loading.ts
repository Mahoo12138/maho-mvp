import type { IndexHtmlTransformResult, Plugin } from 'vite'
import type { ResolvedMahoPluginOptions } from '../types'

/**
 * HTML 模板注入全局 Loading。
 *
 * - 仅对 host 角色生效（remote 没有 index.html）
 * - 在 <body> 开头注入 spinner + 控制样式
 * - boot 完成 mount 后调用 MahoLoading.hide() 触发淡出
 * - 用户可通过 options.loading.html 替换默认 spinner
 */
export function mahoLoadingPlugin(
  options: ResolvedMahoPluginOptions,
): Plugin {
  return {
    name: 'maho:loading',
    transformIndexHtml: {
      order: 'pre',
      handler(html): IndexHtmlTransformResult | string {
        if (options.role !== 'host') return html
        if (options.loading.disabled) return html

        const styleVars = `--maho-loading-bg: ${options.loading.background}; --maho-loading-color: ${options.loading.color};`
        const inner =
          options.loading.html ?? '<div class="maho-spinner"></div>'

        const injection = `
<style data-maho-loading>
  #maho-loading {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--maho-loading-bg, #ffffff);
    z-index: 99999;
    transition: opacity 0.25s ease, visibility 0.25s ease;
    ${styleVars}
  }
  #maho-loading[data-hidden] {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .maho-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #e5e7eb;
    border-top-color: var(--maho-loading-color, #6366f1);
    border-radius: 50%;
    animation: maho-spin 0.7s linear infinite;
  }
  @keyframes maho-spin { to { transform: rotate(360deg); } }
</style>
<div id="maho-loading" aria-label="Loading application">${inner}</div>
`.trim()

        // 把内容塞到 <body> 起始位置
        if (/<body[^>]*>/i.test(html)) {
          return html.replace(/<body([^>]*)>/i, `<body$1>\n${injection}\n`)
        }
        // 极端情况：没有 body 标签，追加到 html 末尾
        return html + '\n' + injection
      },
    },
  }
}
