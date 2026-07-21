<template>
  <div class="flex items-center gap-2">
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
      aria-label="登录"
      color="neutral"
      variant="ghost"
      class="lg:hidden"
    />
    <UButton
      to="/signup"
      icon="i-lucide-user-plus"
      aria-label="注册"
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
