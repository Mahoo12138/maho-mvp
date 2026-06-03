<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <section class="home-page">
    <h2>Hello from module-home remote!</h2>
    <p>This page is exposed by the <code>module-home</code> remote and consumed by the host through module federation.</p>
    <ul>
      <li><RouterLink to="/home/about">/home/about</RouterLink> — static About page</li>
      <li><RouterLink to="/home/counter">/home/counter</RouterLink> — pinia counter (singleton verification)</li>
    </ul>
  </section>
</template>

<style scoped>
.home-page {
  padding: 1rem;
  border: 1px dashed #6366f1;
  border-radius: 6px;
}
code {
  background: #f3f4f6;
  padding: 0 0.25rem;
  border-radius: 3px;
}
ul {
  margin-top: 1rem;
  line-height: 1.8;
}
a {
  color: #4f46e5;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
</style>
