import { defineModuleRoutes } from '@maho/boot-vue'

export default defineModuleRoutes({
  prefix: '/home',
  routes: [
    {
      path: '/',
      name: 'home-index',
      component: () => import('./pages/Home.vue'),
      meta: { layout: 'default', title: 'Home' },
    },
    {
      path: '/about',
      name: 'home-about',
      component: () => import('./pages/About.vue'),
      meta: { layout: 'default', title: 'About' },
    },
    {
      path: '/counter',
      name: 'home-counter',
      component: () => import('./pages/Counter.vue'),
      meta: { layout: 'default', title: 'Counter' },
    },
  ],
})
