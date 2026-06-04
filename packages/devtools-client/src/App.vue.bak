<template>
  <div class="devtools-shell">
    <nav class="sidebar">
      <div class="sidebar-header">Maho Devtools</div>
      <a
        v-for="page in sortedPages"
        :key="page.id"
        :href="page.options.path"
        :class="['sidebar-item', { active: matched?.meta.activity === page }]"
        @click.prevent="navigate(page.options.path)"
      >
        {{ page.name }}
      </a>
      <div class="sidebar-footer">
        <span class="status-dot" :class="{ connected }"></span>
        {{ connected ? 'Connected' : 'Disconnected' }}
      </div>
    </nav>
    <main class="content">
      <component v-if="matched" :is="matched.component" />
      <div v-else-if="ready" class="empty">No panel matches <code>{{ currentPath }}</code></div>
      <div v-else class="empty">Loading…</div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useContext } from './client/context'
import type { Activity } from './client/router'

const ctx = useContext()
const routerSvc = ctx.router
const router = routerSvc.router

const sortedPages = computed<Activity[]>(() => {
  return Object.values(routerSvc.pages)
    .filter((p) => !p.disabled())
    .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
})

const matched = computed(() => router.currentRoute.value.matched[0])
const currentPath = computed(() => router.currentRoute.value.path)
const connected = computed(() => !!ctx.socket.socket.value)
const ready = computed(() => ctx.$loader.ready.value)

function navigate(path: string): void {
  router.push(path).catch(console.warn)
}
</script>

<style>
:root {
  color-scheme: dark;
}
body {
  margin: 0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0f0f1e;
  color: #e0e0e0;
}
</style>

<style scoped>
.devtools-shell {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 220px;
  background: #16213e;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-header {
  padding: 16px;
  font-weight: 700;
  font-size: 14px;
  color: #e0e0e0;
  border-bottom: 1px solid #0f3460;
}
.sidebar-item {
  padding: 10px 16px;
  color: #a0a0b0;
  text-decoration: none;
  font-size: 13px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.sidebar-item:hover { background: #1a1a3e; color: #e0e0e0; }
.sidebar-item.active {
  background: #1a1a3e;
  color: #fff;
  border-left-color: #e94560;
}
.sidebar-footer {
  margin-top: auto;
  padding: 12px 16px;
  font-size: 11px;
  color: #888;
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid #0f3460;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}
.status-dot.connected { background: #4ecca3; }
.content {
  flex: 1;
  overflow: auto;
  padding: 24px;
}
.empty {
  color: #666;
  font-size: 13px;
  text-align: center;
  padding-top: 80px;
}
</style>
