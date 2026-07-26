<script setup lang="ts">
/**
 * 晴空玻璃会员卡 —— 移植自设计稿 dreamy.jsx 的 DreamPass。
 *
 * 一张以「晴空」为底的玻璃质感会员卡：开通显示姓名 + 有效期，
 * 未开通显示「推开云层 · 点亮晴空」蒙层。个人中心 / 会员权益页复用。
 */
withDefaults(defineProps<{
  member?: boolean
  name?: string
  /** 有效期文案，如 2026 / 07 */
  expire?: string
  /** 不传则跟随站点明暗模式 */
  theme?: 'light' | 'dark'
}>(), {
  member: false,
  name: '晴空旅人',
  expire: '—— / ——',
})
</script>

<template>
  <div class="ylf-pass relative aspect-[1.6/1] w-full overflow-hidden rounded-3xl">
    <SkyScene :theme="theme" :sun="false" clouds="mini" sun-x="72%" sun-y="18%" class="pointer-events-none" />
    <!-- 底部压暗，保证玻璃信息条清晰 -->
    <div
      class="pointer-events-none absolute inset-0 z-[2]"
      style="background: linear-gradient(180deg, transparent 44%, rgba(8,32,74,.46) 100%)"
    />

    <!-- 顶部：云朵标识 + logo -->
    <div class="absolute inset-x-4 top-4 z-[5] flex items-center justify-between text-white">
      <span class="ylf-pass-shadow inline-flex items-center gap-2">
        <span class="ylf-pass-tile inline-flex size-9 items-center justify-center rounded-xl">
          <UIcon name="i-lucide-cloud" class="size-5" />
        </span>
        <span class="text-sm font-bold">云乐坊会员</span>
      </span>
      <YlfLogo class="h-6 w-9 text-white/90" aria-hidden="true" />
    </div>

    <!-- 玻璃信息条 -->
    <div class="ylf-pass-strip absolute inset-x-3.5 bottom-3.5 z-[5] flex items-end justify-between rounded-2xl px-4 py-3 text-white">
      <div>
        <div class="text-[11px] tracking-[0.15em] opacity-90">
          跨应用通用 · CROSS-APP
        </div>
        <div class="mt-0.5 text-xl font-bold">
          {{ member ? name : '晴空旅人' }}
        </div>
      </div>
      <div class="text-right">
        <div class="text-[9.5px] tracking-[0.12em] opacity-90">
          VALID THRU
        </div>
        <div class="text-sm font-bold">
          {{ member ? expire : '—— / ——' }}
        </div>
      </div>
    </div>

    <!-- 未开通蒙层 -->
    <div
      v-if="!member"
      class="ylf-pass-lock absolute inset-0 z-[6] flex flex-col items-center justify-center gap-2"
    >
      <span class="inline-flex size-11 items-center justify-center rounded-full bg-white/85">
        <UIcon name="i-lucide-cloud" class="size-6 text-sky-500" />
      </span>
      <span class="ylf-pass-shadow text-[13.5px] font-bold text-white">推开云层 · 点亮晴空</span>
    </div>
  </div>
</template>

<style scoped>
.ylf-pass {
  box-shadow:
    0 30px 60px -20px rgba(40, 70, 140, 0.55),
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.6);
}

.ylf-pass-shadow {
  text-shadow: 0 1px 6px rgba(0, 40, 90, 0.4);
}

.ylf-pass-tile {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.ylf-pass-strip {
  background: rgba(12, 32, 70, 0.34);
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.38);
  text-shadow:
    0 1px 4px rgba(0, 30, 70, 0.55),
    0 1px 12px rgba(0, 30, 70, 0.4);
}

.ylf-pass-lock {
  background: rgba(20, 40, 80, 0.42);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
</style>
