<template>
  <div class="maho-remote-loading" aria-label="Loading">
    <div class="maho-remote-loading__spinner" />
  </div>
</template>

<script setup lang="ts">
// 远程组件加载中占位。
</script>

<style scoped>
.maho-remote-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  min-height: 80px;
}
.maho-remote-loading__spinner {
  width: 24px;
  height: 24px;
  border: 2px solid #e5e7eb;
  border-top-color: #6366f1;
  border-radius: 50%;
  animation: maho-remote-spin 0.7s linear infinite;
}
@keyframes maho-remote-spin {
  to { transform: rotate(360deg); }
}
</style>
