<template>
  <Suspense>
    <component :is="currentLayout">
      <RouterView />
    </component>
    <template #fallback>
      <div class="maho-layout-loading" />
    </template>
  </Suspense>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, inject } from 'vue'
import { useRoute, RouterView } from 'vue-router'
import { resolveLayout } from '@maho/boot'
import { LAYOUTS_KEY } from '../layouts-key'

const route = useRoute()
const layouts = inject(LAYOUTS_KEY, {})

const currentLayout = computed(() => {
  const layoutId = (route.meta.layout as string | undefined) ?? 'default'
  return defineAsyncComponent(() =>
    resolveLayout(layoutId, layouts).then((c) => ({ default: c as any })),
  )
})
</script>

<style scoped>
.maho-layout-loading {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.6);
}
</style>
