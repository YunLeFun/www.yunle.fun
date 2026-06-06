<script setup lang="ts">
/**
 * 云币余额展示组件。
 *
 * 可放在导航栏、个人中心等处。点击默认跳转钱包页。
 */
const props = withDefaults(defineProps<{
  /** 是否可点击跳转钱包页 */
  link?: boolean
  /** 尺寸 */
  size?: 'sm' | 'md'
}>(), {
  link: true,
  size: 'md',
})

const coin = useCoin()
const { user } = useTcbAuth()

onMounted(() => {
  if (user.value)
    coin.refresh()
})

const sizeClass = computed(() =>
  props.size === 'sm' ? 'text-sm px-2 py-1 gap-1' : 'text-base px-3 py-1.5 gap-1.5',
)
</script>

<template>
  <component
    :is="link ? 'NuxtLink' : 'div'"
    :to="link ? '/wallet' : undefined"
    class="inline-flex items-center rounded-full bg-primary/10 text-primary font-medium transition-colors"
    :class="[sizeClass, link ? 'hover:bg-primary/15 cursor-pointer' : '']"
  >
    <UIcon name="i-lucide-coins" :class="size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'" />
    <span v-if="coin.loading.value && !coin.account.value">--</span>
    <span v-else>{{ coin.balance.value }}</span>
    <span class="opacity-70">云币</span>
  </component>
</template>
