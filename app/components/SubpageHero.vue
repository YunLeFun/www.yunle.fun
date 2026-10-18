<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'

/**
 * 个人中心子页面的统一页头：窄版晴空横幅 + 返回按钮 + 标题。
 *
 * 设置、钱包、关注动态等子页共用，和个人中心大头图同属一片天空；
 * 右侧可通过 trailing 插槽放头像或操作。
 */
withDefaults(defineProps<{
  title: string
  description?: string
  /** 返回目标，默认回到个人中心 */
  back?: string
  backLabel?: string
}>(), {
  back: '/profile',
  backLabel: '返回个人中心',
})
</script>

<template>
  <SkyHero clouds="mini" class="ylf-rise">
    <div class="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
      <Button
        as-child
        variant="ghost"
        size="icon-lg"
        class="ylf-glass-btn shrink-0 rounded-full"
      >
        <NuxtLink :to="back" :aria-label="backLabel">
          <ArrowLeftIcon />
        </NuxtLink>
      </Button>
      <div class="min-w-0 flex-1 text-white">
        <h1 class="ylf-hero-shadow truncate text-2xl font-semibold tracking-tight sm:text-3xl">
          {{ title }}
        </h1>
        <p v-if="description" class="ylf-hero-shadow mt-0.5 line-clamp-2 text-sm leading-6 text-white/85">
          {{ description }}
        </p>
      </div>
      <slot name="trailing" />
    </div>
  </SkyHero>
</template>
