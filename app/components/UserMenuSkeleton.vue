<script setup lang="ts">
/**
 * 头像区加载占位。
 *
 * 在恢复登录态 / 懒加载用户菜单期间显示，避免已登录用户刷新时
 * 闪现「登录 / 注册」按钮。尺寸对齐头像按钮，防止布局抖动。
 */
</script>

<template>
  <div
    class="flex items-center gap-2 h-8 px-2.5"
    aria-hidden="true"
  >
    <USkeleton class="size-6 rounded-full" />
    <USkeleton class="hidden h-4 w-16 rounded-md lg:block" />
  </div>
</template>
