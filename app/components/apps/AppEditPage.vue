<script setup lang="ts">
const route = useRoute()
await navigateTo(`https://apps.yunle.fun/workshop/${encodeURIComponent(String(route.params.slug))}/edit`, { external: true, replace: true })
</script>

<template>
  <p>正在前往应用管理平台…</p>
</template>
