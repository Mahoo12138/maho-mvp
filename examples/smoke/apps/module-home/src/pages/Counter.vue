<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useCounterStore } from '../stores/counter'

const counter = useCounterStore()
</script>

<template>
  <section class="counter-page">
    <h2>Counter ({{ counter.value }})</h2>
    <p>
      This counter lives in a pinia store inside the <code>module-home</code> remote.
      If the host and remote share the same pinia instance via federation singleton,
      navigating away and back will preserve the value.
    </p>
    <div class="controls">
      <button @click="counter.increment">+1</button>
      <button @click="counter.reset">reset</button>
    </div>
    <p><RouterLink to="/home/">← back to home</RouterLink></p>
  </section>
</template>

<style scoped>
.counter-page {
  padding: 1rem;
  border: 1px dashed #f59e0b;
  border-radius: 6px;
  line-height: 1.6;
}
.controls {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
button {
  padding: 0.4rem 0.9rem;
  border: 1px solid #d1d5db;
  background: #f9fafb;
  border-radius: 4px;
  cursor: pointer;
  font: inherit;
}
button:hover {
  background: #f3f4f6;
}
code {
  background: #f3f4f6;
  padding: 0 0.25rem;
  border-radius: 3px;
}
a {
  color: #4f46e5;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
</style>
