<script setup lang="ts">
/**
 * 晴空 Hero —— 圆角晴空背景区块（SkyScene + 文案侧压暗 + 内容层）。
 *
 * 会员权益页、个人中心等页面的统一头图。内容通过默认插槽传入，
 * 自行控制内边距与栅格；组件负责晴空背景、scrim、圆角与层叠。
 * 自动跟随站点明暗模式（浅色白日 / 深色黄昏）。
 */
withDefaults(defineProps<{
  /** 是否在文案侧叠加压暗层（白字 hero 建议开启） */
  scrim?: boolean
}>(), {
  scrim: true,
})

const colorMode = useColorMode()
const skyTheme = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
</script>

<template>
  <section class="ylf-sky-hero relative overflow-hidden rounded-[1.75rem] sm:rounded-[2rem]">
    <SkyScene :theme="skyTheme" :sun="false" class="pointer-events-none" />
    <div v-if="scrim" class="ylf-sky-hero__scrim pointer-events-none absolute inset-0 z-[1]" />
    <div class="relative z-[2]">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.ylf-sky-hero {
  box-shadow: 0 28px 60px -30px color-mix(in srgb, #0b82c4 60%, transparent);
}

.ylf-sky-hero__scrim {
  background: linear-gradient(
    102deg,
    rgba(8, 32, 74, 0.5) 0%,
    rgba(8, 32, 74, 0.28) 40%,
    rgba(8, 32, 74, 0.07) 66%,
    transparent 84%
  );
}
</style>
