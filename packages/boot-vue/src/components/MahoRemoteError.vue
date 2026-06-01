<template>
  <div class="maho-remote-error" role="alert">
    <div class="maho-remote-error__title">远程组件加载失败</div>
    <div class="maho-remote-error__hint">请检查网络或稍后重试</div>
  </div>
</template>

<script setup lang="ts">
// 框架内置错误边界占位，业务可通过自定义 errorComponent 覆盖。
</script>

<style scoped>
.maho-remote-error {
  padding: 16px 20px;
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  border-radius: 6px;
  font: 14px / 1.6 system-ui, sans-serif;
}
.maho-remote-error__title {
  font-weight: 600;
  margin-bottom: 4px;
}
.maho-remote-error__hint {
  color: #991b1b;
  font-size: 13px;
}
</style>
