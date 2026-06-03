<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <header>
      <h1>Maho Smoke Host</h1>
      <nav>
        <RouterLink to="/home/">Home</RouterLink>
        <RouterLink to="/home/about">About</RouterLink>
        <RouterLink to="/home/counter">Counter</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  font-family: system-ui, sans-serif;
  padding: 1rem;
  max-width: 880px;
  margin: 0 auto;
}
header {
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
}
h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}
nav {
  display: flex;
  gap: 0.75rem;
}
nav a {
  color: #4f46e5;
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
nav a.router-link-exact-active {
  background: #eef2ff;
  font-weight: 600;
}
nav a:hover {
  background: #f3f4f6;
}
</style>
