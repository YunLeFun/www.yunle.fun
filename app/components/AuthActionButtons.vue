<script setup lang="ts">
const emit = defineEmits<{
  prepare: []
}>()
</script>

<template>
  <div
    class="flex items-center gap-2"
    @pointerenter="emit('prepare')"
    @focusin="emit('prepare')"
  >
    <UButton
      to="/login"
      label="登录"
      color="neutral"
      variant="outline"
      class="hidden lg:inline-flex"
    />
    <UButton
      to="/login"
      icon="i-ri-login-box-line"
      color="neutral"
      variant="ghost"
      class="lg:hidden"
    />
    <UButton
      label="注册"
      color="neutral"
      trailing-icon="i-lucide-arrow-right"
      class="hidden lg:inline-flex"
      to="/signup"
    />
  </div>
</template>
