<script setup lang="ts">
import { ArrowLeftIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'

/**
 * 个人中心子页面的统一页头：窄版晴空横幅 + 返回按钮 + 标题。
 *
 * 设置、钱包、关注动态等子页共用，和个人中心大头图同属一片天空；
 * 博客、日志等一级内容页传 back=false 与 icon，左侧换成玻璃图标块。
 * 右侧可通过 trailing 插槽放头像或操作。
 */
withDefaults(defineProps<{
  title: string
  description?: string
  /** 返回目标，默认回到个人中心；false 表示不显示返回按钮 */
  back?: string | false
  backLabel?: string
  /** 不显示返回按钮时，左侧的图标 */
  icon?: string
}>(), {
  back: '/profile',
  backLabel: '返回个人中心',
})
</script>

<template>
  <SkyHero clouds="mini" class="ylf-rise">
    <div class="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
      <Button
        v-if="back"
        as-child
        variant="ghost"
        size="icon-lg"
        class="ylf-glass-btn shrink-0 rounded-full"
      >
        <NuxtLink :to="back" :aria-label="backLabel">
          <ArrowLeftIcon />
        </NuxtLink>
      </Button>
      <span
        v-else-if="icon"
        class="ylf-glass inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white"
        aria-hidden="true"
      >
        <Icon :name="icon" class="size-5" />
      </span>
      <div class="min-w-0 flex-1 text-white">
        <h1 class="ylf-hero-shadow truncate text-xl font-semibold tracking-tight sm:text-2xl">
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
