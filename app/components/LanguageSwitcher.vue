<script setup lang="ts">
// @ts-expect-error useI18n is provided by @nuxtjs/i18n which is currently disabled
const { locale, setLocale } = useI18n()

const availableLocales: {
  code: 'zh-CN' | 'en'
  label: string
  icon: string
}[] = [
  {
    code: 'zh-CN',
    label: '简体中文',
    icon: 'i-twemoji-flag-china',
  },
  {
    code: 'en',
    label: 'English',
    icon: 'i-twemoji-flag-united-states',
  },
]

const currentLocale = computed(() => {
  return availableLocales.find(l => l.code === locale.value)
})

const items = computed(() => {
  return availableLocales.map(l => ({
    label: l.label,
    icon: l.icon,
    onSelect: () => setLocale(l.code),
    active: l.code === locale.value,
  }))
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'end' }"
  >
    <UButton
      :icon="currentLocale?.icon || 'i-lucide-globe'"
      color="neutral"
      variant="ghost"
      :aria-label="`当前语言: ${currentLocale?.label}`"
    >
      <span class="hidden sm:inline">
        {{ currentLocale?.label }}
      </span>
    </UButton>
  </UDropdownMenu>
</template>
