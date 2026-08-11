<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const activeItem = '官网'

const menuItems = [
  {
    label: '官网',
    to: 'https://www.yunle.fun',
    color: 'primary',
    checked: true,
    type: 'checkbox',
  },
  {
    label: '应用',
    to: 'https://apps.yunle.fun/',
  },
  {
    label: '博客',
    to: '/blog',
  },
  {
    label: '日志',
    to: '/changelog',
  },
  {
    label: '工作室',
    to: 'https://studio.yunle.fun/',
  },
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
  <DropdownMenu v-slot="{ open }" :modal="false">
    <DropdownMenuTrigger as-child>
      <AppButton
        variant="subtle"
        size="xs"
        class="rounded-full font-semibold"
        :class="open ? 'bg-primary/15' : undefined"
      >
        {{ activeItem }}
        <ChevronDownIcon data-icon="inline-end" class="transition-transform duration-200" :class="open ? 'rotate-180' : undefined" />
      </AppButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="min-w-36">
      <DropdownMenuGroup>
        <DropdownMenuItem v-for="item in menuItems" :key="item.to" as-child>
          <NuxtLink :to="item.to">
            {{ item.label }}
            <CheckIcon v-if="item.checked" class="ml-auto" />
          </NuxtLink>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
