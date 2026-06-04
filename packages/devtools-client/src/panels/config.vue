<template>
  <div class="config-panel">
    <header class="header">
      <h1>Configuration</h1>
      <div class="actions">
        <span class="mode-badge">mode: {{ data.mode }}</span>
        <button :disabled="reloading" @click="onReload">
          {{ reloading ? 'Reloading…' : 'Reload' }}
        </button>
      </div>
    </header>
    <div class="columns">
      <section class="column">
        <h2>Base</h2>
        <pre>{{ format(data.base) }}</pre>
      </section>
      <section class="column">
        <h2>Override</h2>
        <pre>{{ format(data.current) }}</pre>
      </section>
      <section class="column">
        <h2>Resolved</h2>
        <pre>{{ format(data.resolved) }}</pre>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRpc } from '../client/context'
import type { ConfigPanelData } from '@maho/devtools/shared'

const entry = useRpc<ConfigPanelData>()
const data = computed<ConfigPanelData>(() => entry.value)

const reloading = ref(false)
async function onReload(): Promise<void> {
  reloading.value = true
  try {
    await data.value.reload()
  } catch (e) {
    console.error('[config] reload failed:', e)
  } finally {
    reloading.value = false
  }
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<style scoped>
.config-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mode-badge {
  font-size: 12px;
  background: #1a1a3e;
  color: #c0c0c0;
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid #0f3460;
}
button {
  background: #e94560;
  color: white;
  border: none;
  padding: 6px 14px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
button:disabled {
  background: #555;
  cursor: not-allowed;
}
.columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.column {
  background: #16213e;
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.column h2 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #a0a0b0;
  letter-spacing: 0.05em;
  margin: 0 0 8px;
}
pre {
  flex: 1;
  margin: 0;
  background: #0f0f1e;
  padding: 12px;
  border-radius: 4px;
  font-family: ui-monospace, "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #d0d0d0;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
