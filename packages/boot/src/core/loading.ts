/**
 * 全局 Loading 控制器。
 *
 * 默认操作 DOM 中的 #maho-loading 节点（由 @maho/vite-plugin 在 index.html 中注入）。
 * 通过切换 data-hidden 触发 CSS 过渡，过渡结束后从 DOM 移除以避免遮挡。
 */
export const MahoLoading = {
  show(): void {
    if (typeof document === 'undefined') return
    const el = document.getElementById('maho-loading')
    el?.removeAttribute('data-hidden')
  },

  hide(): void {
    if (typeof document === 'undefined') return
    const el = document.getElementById('maho-loading')
    if (!el) return
    el.setAttribute('data-hidden', '')
    const remove = () => {
      el.remove()
    }
    el.addEventListener('transitionend', remove, { once: true })
    // 兜底：若 CSS 未配置过渡，500ms 后强制移除
    setTimeout(remove, 500)
  },
}
