<script setup lang="ts">
import { Card } from '@/components/ui/card'
</script>

<template>
  <div class="ylf-auth-shell relative min-h-screen min-h-dvh overflow-x-hidden">
    <!-- 梦幻晴空背景（天气之子） -->
    <SkyScene class="pointer-events-none" />
    <!-- 顶部留白处压一层柔和提亮，保证返回按钮在亮空下清晰 -->
    <div class="pointer-events-none absolute inset-x-0 top-0 z-[1] h-32 bg-gradient-to-b from-white/35 to-transparent dark:from-black/20" aria-hidden="true" />

    <div class="absolute left-4 top-[calc(env(safe-area-inset-top)_+_0.75rem)] z-20 sm:left-8 sm:top-8">
      <AppButton
        icon="i-lucide-arrow-left"
        to="/"
        size="lg"
        color="neutral"
        variant="subtle"
        class="ylf-auth-back rounded-full"
        aria-label="返回首页"
        title="返回首页"
      >
        <span class="sm:hidden">返回</span>
        <span class="hidden sm:inline">返回首页</span>
      </AppButton>
    </div>

    <!-- 移动端：晴空铺满顶部，表单做成贴底全宽「上滑卡」；桌面端：居中玻璃卡 -->
    <!-- 桌面端顶部锚定：内容变高时向下生长；紧凑上边距为矮屏保留可用高度 -->
    <main class="ylf-auth-main relative z-10 flex min-h-screen min-h-dvh flex-col justify-end pt-[calc(env(safe-area-inset-top)_+_5rem)] sm:items-center sm:justify-start sm:px-6 sm:pb-6 sm:pt-[clamp(4.75rem,8vh,7rem)]">
      <Card
        class="ylf-auth-card relative isolate w-full gap-0 overflow-hidden rounded-t-3xl rounded-b-none py-0 pb-[env(safe-area-inset-bottom)] sm:mx-auto sm:max-w-sm sm:rounded-b-3xl sm:pb-0"
      >
        <div class="ylf-auth-card-content p-4 sm:p-5">
          <slot />
        </div>
      </Card>
    </main>
  </div>
</template>

<style scoped>
.ylf-auth-shell {
  isolation: isolate;
}

:global(html:has(.ylf-auth-shell)) {
  scrollbar-gutter: stable both-edges;
}

/* 磨砂玻璃卡片 —— 让晴空背景隐约透出；圆角由模板按端响应式控制（移动端只圆上方） */
.ylf-auth-card {
  background: color-mix(in srgb, var(--ylf-surface) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--ylf-glass-highlight) 55%, transparent);
  box-shadow:
    0 1px 0 0 color-mix(in srgb, var(--ylf-glass-highlight) 70%, transparent) inset,
    0 30px 64px -28px color-mix(in srgb, var(--ui-primary) 55%, transparent);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  overflow-anchor: none;
}

/* 单层静态晨光保留云乐坊识别度，不引入持续动画或额外装饰节点。 */
.ylf-auth-card::before {
  position: absolute;
  z-index: 0;
  top: -8rem;
  left: -7rem;
  width: 21rem;
  height: 18rem;
  border-radius: 9999px;
  background: radial-gradient(
    circle,
    color-mix(in srgb, var(--ylf-glass-highlight) 86%, transparent) 0%,
    color-mix(in srgb, var(--ui-primary) 14%, transparent) 42%,
    transparent 70%
  );
  content: '';
  filter: blur(8px);
  opacity: 0.58;
  pointer-events: none;
}

.ylf-auth-card-content {
  position: relative;
  z-index: 1;
}

:global(.dark .ylf-auth-card) {
  background: color-mix(in srgb, var(--ylf-surface) 80%, transparent);
  border-color: color-mix(in srgb, var(--ylf-glass-highlight) 16%, transparent);
  box-shadow:
    0 1px 0 0 color-mix(in srgb, var(--ylf-glass-highlight) 10%, transparent) inset,
    0 30px 64px -28px color-mix(in srgb, var(--ylf-shadow-color) 72%, transparent);
}

:global(.dark .ylf-auth-card::before) {
  opacity: 0.24;
}

.ylf-auth-back {
  min-height: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 74%, transparent);
  background: color-mix(in srgb, var(--ylf-surface) 76%, transparent);
  box-shadow: 0 10px 24px -18px var(--ui-text);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.ylf-auth-back:hover {
  background: color-mix(in srgb, var(--ylf-surface) 92%, transparent);
  border-color: color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border));
  box-shadow: 0 14px 28px -20px var(--ui-primary);
  transform: translateY(-1px);
}

.ylf-auth-back:focus-visible {
  outline: none;
  box-shadow:
    0 0 0 3px var(--ylf-ring),
    0 10px 24px -18px var(--ui-text);
}

/* 矮屏仍从安全区下方开始，内容向下生长并由页面自然滚动承接。 */
@media (min-width: 640px) and (max-height: 799px) {
  .ylf-auth-main {
    padding-top: calc(env(safe-area-inset-top) + 4rem);
    padding-bottom: 1rem;
  }
}
</style>
