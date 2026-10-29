<script setup lang="ts">
import { Card } from '@/components/ui/card'

const { backTarget } = useAuthEntry()
const route = useRoute()
const showMascot = computed(() => route.path === '/login' || route.path === '/signup')
const passwordFocused = shallowRef(false)

function trackFocus(event: FocusEvent) {
  const target = event.target
  passwordFocused.value = target instanceof HTMLInputElement && target.type === 'password'
}
</script>

<template>
  <div class="ylf-auth-shell relative min-h-screen min-h-dvh overflow-x-hidden">
    <div class="ylf-auth-clouds pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <CuteCloud shape="long" class="ylf-auth-cloud ylf-auth-cloud--near" />
      <CuteCloud shape="small" class="ylf-auth-cloud ylf-auth-cloud--far" />
    </div>
    <div class="absolute left-4 top-[calc(env(safe-area-inset-top)_+_0.75rem)] z-20 sm:left-8 sm:top-8">
      <AppButton
        v-if="backTarget"
        icon="i-lucide-arrow-left"
        :href="backTarget.href"
        size="lg"
        color="neutral"
        variant="ghost"
        class="ylf-auth-back max-w-[calc(100vw-2rem)]"
        :aria-label="backTarget.label"
        :title="backTarget.label"
      >
        <span class="truncate">{{ backTarget.label }}</span>
      </AppButton>
      <AppButton
        v-else
        icon="i-lucide-arrow-left"
        to="/"
        size="lg"
        color="neutral"
        variant="ghost"
        class="ylf-auth-back"
        aria-label="返回首页"
        title="返回首页"
      >
        <span class="sm:hidden">返回</span>
        <span class="hidden sm:inline">返回首页</span>
      </AppButton>
    </div>

    <!-- 各端统一顶部锚定，避免短授权状态贴底并被系统浏览器工具栏遮挡。 -->
    <!-- 长表单向下生长，由页面自然滚动承接；安全区留白放在卡片外。 -->
    <main class="ylf-auth-main relative z-10 flex min-h-screen min-h-dvh flex-col items-center justify-start px-4 pt-[calc(env(safe-area-inset-top)_+_5rem)] pb-[calc(env(safe-area-inset-bottom)_+_1rem)] sm:px-6 sm:pb-6 sm:pt-[clamp(4.75rem,8vh,7rem)]">
      <Card
        class="ylf-auth-card relative isolate mx-auto w-full max-w-sm gap-0 py-0"
        @focusin="trackFocus"
        @focusout="passwordFocused = false"
      >
        <div class="ylf-auth-card-content relative z-10 space-y-5 p-4 sm:p-5">
          <div class="flex min-h-8 items-center justify-between gap-3">
            <NuxtLink to="/" class="inline-flex min-h-8 items-center gap-2 text-sm font-medium text-foreground" aria-label="云乐坊账号，返回首页">
              <YlfLogo class="h-5 w-7 text-primary" aria-hidden="true" />
              云乐坊账号
            </NuxtLink>
            <CuteCloud
              v-if="showMascot"
              class="ylf-auth-mascot"
              face
              :animated="false"
              :look="passwordFocused ? { x: -1, y: -1 } : { x: -0.6, y: 0.5 }"
            />
          </div>
          <slot />
        </div>
      </Card>
    </main>
  </div>
</template>

<style scoped>
.ylf-auth-shell {
  background:
    radial-gradient(
      ellipse 42rem 28rem at 75% 0%,
      color-mix(in srgb, var(--ylf-c-brand) 9%, transparent),
      transparent 70%
    ),
    var(--ylf-c-bg-soft);
}

.ylf-auth-cloud {
  position: absolute;
  opacity: 0.55;
}

.ylf-auth-cloud--near {
  top: 5rem;
  left: calc(50% - 32rem);
  width: 24rem;
}

.ylf-auth-cloud--far {
  right: calc(50% - 31rem);
  bottom: 10%;
  width: 17rem;
  opacity: 0.35;
}

.ylf-auth-mascot {
  width: 3rem;
  flex: none;
  filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--ylf-c-brand) 16%, transparent));
}

.ylf-auth-back {
  background: color-mix(in srgb, var(--ylf-c-surface) 64%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:global(html:has(.ylf-auth-shell)) {
  scrollbar-gutter: stable;
}

.ylf-auth-card {
  box-shadow: 0 18px 48px -32px color-mix(in srgb, var(--ylf-c-brand) 30%, transparent);
  overflow-anchor: none;
}

.ylf-auth-card::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  background: radial-gradient(
    ellipse 16rem 9rem at 100% 0%,
    color-mix(in srgb, var(--ylf-c-brand) 5%, transparent),
    transparent 75%
  );
  content: '';
  pointer-events: none;
}

/* 矮屏仍从安全区下方开始，内容向下生长并由页面自然滚动承接。 */
@media (min-width: 640px) and (max-height: 799px) {
  .ylf-auth-main {
    padding-top: calc(env(safe-area-inset-top) + 4rem);
    padding-bottom: 1rem;
  }
}
</style>
