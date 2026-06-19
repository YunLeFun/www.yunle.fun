<script setup lang="ts">
const emit = defineEmits<{
  reveal: []
}>()
</script>

<template>
  <div
    class="flex items-center gap-2"
    @pointerenter="emit('reveal')"
    @focusin="emit('reveal')"
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
