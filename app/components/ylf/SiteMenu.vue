<script setup lang="ts">
import { CheckIcon, ChevronDownIcon } from '@lucide/vue'

const menuItems = [
  { label: '官网', to: 'https://www.yunle.fun', current: true },
  { label: '应用', to: '/explore' },
  { label: '博客', to: '/blog' },
  { label: '日志', to: '/changelog' },
  { label: '工作室', to: 'https://studio.yunle.fun/' },
]
</script>

<template>
  <HeaderDisclosure label="官网">
    <template #trigger>
      官网
      <ChevronDownIcon class="size-3.5 text-[var(--ylf-c-text-3)] transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
    </template>

    <template #default="{ select }">
      <nav class="min-w-42" aria-label="站点导航">
        <ul>
          <li v-for="item in menuItems" :key="item.to">
            <NuxtLink
              :to="item.to"
              :aria-current="item.current ? 'true' : undefined"
              class="flex min-h-11 items-center gap-2 rounded-[var(--ylf-radius-menu-item)] px-3 py-2 text-[0.9375rem] hover:bg-[var(--ylf-c-brand-soft)] hover:text-primary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&[aria-current=true]]:bg-[var(--ylf-c-brand-soft)] [&[aria-current=true]]:text-primary"
              @click="select"
            >
              {{ item.label }}
              <CheckIcon v-if="item.current" class="ml-auto size-4 text-primary" aria-hidden="true" />
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </template>
  </HeaderDisclosure>
</template>
