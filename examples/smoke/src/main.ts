import { createMahoApp, defineLayouts } from '@maho/boot-vue'
import AppShell from './AppShell.vue'
import DefaultLayout from './layouts/Default.vue'

createMahoApp({
  root: AppShell,
  layouts: defineLayouts({ default: DefaultLayout }),
  interceptors: [
    // 根路径无对应路由，重定向到 home 模块首页。
    ({ to }) => (to.path === '/' ? '/home/' : undefined),
  ],
})
