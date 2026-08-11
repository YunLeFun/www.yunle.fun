<script setup lang="ts">
withDefaults(defineProps<{
  presentation?: 'responsive' | 'labeled'
}>(), {
  presentation: 'responsive',
})
</script>

<template>
  <div class="flex items-center gap-2">
    <AppButton
      to="/login"
      label="登录"
      color="neutral"
      variant="outline"
      :class="presentation === 'labeled' ? 'inline-flex' : 'hidden lg:inline-flex'"
    />
    <AppButton
      to="/login"
      icon="i-ri-login-box-line"
      aria-label="登录"
      color="neutral"
      variant="ghost"
      :class="presentation === 'labeled' ? 'hidden' : 'lg:hidden'"
    />
    <AppButton
      to="/signup"
      icon="i-lucide-user-plus"
      aria-label="注册"
      color="neutral"
      variant="ghost"
      :class="presentation === 'labeled' ? 'hidden' : 'lg:hidden'"
    />
    <AppButton
      label="注册"
      color="neutral"
      trailing-icon="i-lucide-arrow-right"
      :class="presentation === 'labeled' ? 'inline-flex' : 'hidden lg:inline-flex'"
      to="/signup"
    />
  </div>
</template>
