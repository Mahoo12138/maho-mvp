<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="about-page">
    <h2>About this smoke example</h2>
    <p>
      The smoke workspace exists to exercise the full Maho pipeline:
      <code>@maho/cli</code> spawns vite programmatically for both the host and the
      <code>module-home</code> remote, and the host loads remote routes through
      <code>@originjs/vite-plugin-federation</code>.
    </p>
    <p>
      Both this page and the host are Vue 3, sharing a single Vue runtime via the
      shared singleton declared in <code>@maho/boot-vue</code>.
    </p>
    <p><RouterLink to="/home/">← back to home</RouterLink></p>
  </section>
</template>

<style scoped>
.about-page {
  padding: 1rem;
  border: 1px dashed #10b981;
  border-radius: 6px;
  line-height: 1.6;
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
