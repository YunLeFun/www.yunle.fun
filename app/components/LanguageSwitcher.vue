<script setup lang="ts">
import { CheckIcon } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// @ts-expect-error useI18n is provided by @nuxtjs/i18n which is currently disabled
const { locale, setLocale } = useI18n()

const availableLocales: {
  code: 'zh-CN' | 'en'
  label: string
  flag: string
}[] = [
  {
    code: 'zh-CN',
    label: '简体中文',
    flag: '🇨🇳',
  },
  {
    code: 'en',
    label: 'English',
    flag: '🇺🇸',
  },
]

const currentLocale = computed(() => {
  return availableLocales.find(l => l.code === locale.value)
})
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <AppButton
        icon="i-lucide-languages"
        color="neutral"
        variant="ghost"
        :aria-label="`当前语言: ${currentLocale?.label}`"
      >
        <span class="hidden sm:inline">
          {{ currentLocale?.label }}
        </span>
      </AppButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-44">
      <DropdownMenuGroup>
        <DropdownMenuItem
          v-for="item in availableLocales"
          :key="item.code"
          @select="setLocale(item.code)"
        >
          <span>{{ item.flag }} {{ item.label }}</span>
          <CheckIcon v-if="item.code === locale" class="ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
