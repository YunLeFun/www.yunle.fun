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
        variant="ghost"
        color="neutral"
        size="md"
        class="ylf-site-menu__trigger"
      >
        {{ activeItem }}
        <ChevronDownIcon data-icon="inline-end" class="ylf-site-menu__chevron size-3.5" :class="open ? 'rotate-180' : undefined" />
      </AppButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="8" class="min-w-45">
      <DropdownMenuGroup>
        <DropdownMenuItem v-for="item in menuItems" :key="item.to" as-child class="min-h-11 text-[0.9375rem]">
          <NuxtLink :to="item.to" :aria-current="item.checked ? 'true' : undefined">
            {{ item.label }}
            <CheckIcon v-if="item.checked" class="ml-auto text-primary" aria-hidden="true" />
          </NuxtLink>
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
.ylf-site-menu__trigger {
  min-height: 2.75rem;
  gap: var(--ylf-space-2);
  padding-inline: var(--ylf-space-3);
  border-radius: var(--ylf-radius-sm);
  color: var(--ylf-c-text-2);
  font-family: var(--ylf-font-body);
  font-size: 0.875rem;
  font-weight: 500;
  transition:
    background-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.ylf-site-menu__trigger:is(:hover, [data-state='open']) {
  background: var(--ylf-c-bg-soft);
  color: var(--ylf-c-text);
}

.ylf-site-menu__trigger:focus-visible {
  border-color: transparent;
  outline: 2px solid var(--ylf-c-brand);
  outline-offset: -2px;
  box-shadow: none;
}

.ylf-site-menu__chevron {
  color: var(--ylf-c-text-3);
  transition: transform var(--ylf-duration-fast) var(--ylf-ease-standard);
}
</style>
