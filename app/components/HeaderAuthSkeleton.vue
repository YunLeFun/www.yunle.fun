<template>
  <div
    class="flex h-8 items-center justify-end gap-1.5"
    aria-hidden="true"
    data-testid="header-auth-skeleton"
  >
    <!-- 对齐登录后的通知按钮。 -->
    <AppSkeleton class="size-8 shrink-0 rounded-md" />

    <!-- 对齐登录后的头像按钮；桌面端同时为固定宽度昵称预留空间。 -->
    <div class="flex h-8 items-center gap-2 px-2">
      <AppSkeleton class="size-6 shrink-0 rounded-full" />
      <AppSkeleton class="hidden h-4 w-16 rounded-md lg:block" />
    </div>
  </div>
</template>
