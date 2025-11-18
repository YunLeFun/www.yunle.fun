<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const activeItem = '官网'

const menuItems: DropdownMenuItem[] = [
  {
    label: '官网',
    to: 'https://www.yunle.fun',
    color: 'primary',
    checked: true,
    type: 'checkbox'
  },
  {
    label: '应用',
    to: 'https://apps.yunle.fun/'
  },
  {
    label: '博客',
    to: '/blog'
  },
  {
    label: '日志',
    to: '/changelog'
  },
  {
    label: '工作室',
    to: 'https://studio.yunle.fun/'
  }
  // {
  //   label: 'Docs',
  //   to: 'https://docs.yunle.fun/'
  // },
  // {
  //   label: 'Dashboard',
  //   to: 'https://dashboard-template.nuxt.dev/'
  // },
  // {
  //   label: 'Chat',
  //   to: 'https://chat-template.nuxt.dev/'
  // },
  // {
  //   label: 'Portfolio',
  //   to: 'https://portfolio-template.nuxt.dev/'
  // },
  // {
  //   label: 'Changelog',
  //   to: 'https://changelog-template.nuxt.dev/'
  // }
]
</script>

<template>
  <UDropdownMenu
    v-slot="{ open }"
    :modal="false"
    :items="menuItems"
    :content="{ align: 'start' }"
    :ui="{ content: 'min-w-fit' }"
    size="xs"
  >
    <UButton
      :label="activeItem"
      variant="subtle"
      trailing-icon="i-lucide-chevron-down"
      size="xs"
      class="font-semibold rounded-full truncate"
      :class="[open && 'bg-primary/15']"
      :ui="{
        trailingIcon: ['transition-transform duration-200', open ? 'rotate-180' : undefined].filter(Boolean).join(' ')
      }"
    />
  </UDropdownMenu>
</template>
