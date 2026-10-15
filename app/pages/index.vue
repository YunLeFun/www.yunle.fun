<script setup lang="ts">
import HomeCta from '~/components/home/HomeCta.vue'
import HomeHeroBalloons from '~/components/home/HomeHeroBalloons.vue'
import HomeHeroSky from '~/components/home/HomeHeroSky.vue'
import HomeJourney from '~/components/home/HomeJourney.vue'
import { useSkyParallax } from '~/composables/useSkyParallax'
import { homePage as page } from '~/config'

const title = page.seo.title || page.title
const description = page.seo.description || page.description
// 首页只消费页头恢复后的轻量共享状态，不直接导入 CloudBase 认证实现。
// 匿名访客因此无需为首屏下载认证 SDK；已有会话仍会由 HeaderAuthArea 恢复并更新这里。
const authReady = useState<boolean>('auth_ready', () => false)
const user = useState<{ id?: string } | null>('auth_user', () => null)
const authStatus = computed<'pending' | 'authenticated' | 'guest'>(() =>
  !authReady.value ? 'pending' : user.value ? 'authenticated' : 'guest',
)

useSeoMeta({
  titleTemplate: '',
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

const hero = shallowRef<HTMLElement | null>(null)
useSkyParallax(hero)

// 标题逐字弹入；读屏软件读取完整的隐藏标题，不逐字朗读。
const headlineText = '云之彼端，乐趣无限'
const headline = [
  { text: '云之彼端，', accent: false },
  { text: '乐趣', accent: true },
  { text: '无限', accent: false },
].reduce<{ chars: { text: string, index: number }[], accent: boolean }[]>((segments, segment) => {
  const offset = segments.reduce((count, item) => count + item.chars.length, 0)
  segments.push({
    accent: segment.accent,
    chars: [...segment.text].map((text, index) => ({ text, index: offset + index })),
  })
  return segments
}, [])

function scrollToApps() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById('home-apps')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
}

const clientMounted = ref(false)
const renderedAuthStatus = computed(() => clientMounted.value ? authStatus.value : 'pending')

const profileAction = {
  label: '个人中心',
  icon: 'i-lucide-circle-user-round',
  to: '/profile',
}
const exploreAction = page.cta.links[0]!

const accountAction = computed(() => {
  if (renderedAuthStatus.value === 'authenticated')
    return profileAction
  if (renderedAuthStatus.value === 'guest')
    return page.hero.links[1]
  return null
})

const journey = computed(() => {
  if (renderedAuthStatus.value === 'guest')
    return page.journey

  if (renderedAuthStatus.value === 'authenticated') {
    return {
      ...page.journey,
      title: '先逛应用，再用统一账号继续探索',
      description: '浏览云乐坊的官方应用，或回到个人中心管理你的统一账号与平台权益。',
      items: page.journey.items.map((item, index) => index === 2
        ? {
            ...item,
            title: '管理你的账号',
            description: '在个人中心查看资料、账号状态与已发布应用。',
            to: '/profile',
            linkLabel: '前往个人中心',
          }
        : item),
    }
  }

  return {
    ...page.journey,
    title: '先逛应用，再决定下一步',
    description: '浏览云乐坊的官方应用，找到感兴趣的作品后再继续。',
    items: page.journey.items.map((item, index) => index === 2
      ? {
          title: '需要时使用统一账号',
          description: '在需要保存状态或使用平台权益时，使用统一账号继续。',
          icon: item.icon,
        }
      : item),
  }
})

const cta = computed(() => {
  if (renderedAuthStatus.value === 'authenticated') {
    return {
      ...page.cta,
      description: '继续浏览应用，或进入个人中心管理你的统一账号与平台权益。',
      links: [
        exploreAction,
        {
          ...profileAction,
          variant: 'outline' as const,
        },
      ],
    }
  }

  if (renderedAuthStatus.value === 'guest')
    return page.cta

  return {
    ...page.cta,
    description: '先看看目前有哪些应用，发现实用、好玩或充满想象力的云端体验。',
    links: [exploreAction],
  }
})

onMounted(() => {
  clientMounted.value = true
})
</script>

<template>
  <div class="home-page">
    <div class="home-progress" aria-hidden="true" />

    <section ref="hero" class="ylf-home-hero relative isolate overflow-hidden">
      <HomeHeroSky />
      <HomeHeroBalloons :balloons="page.hero.balloons" />
      <div class="ylf-home-hero__fade pointer-events-none absolute inset-x-0 bottom-0 z-[5]" aria-hidden="true" />
      <AppContainer class="pointer-events-none relative z-[6] py-20 sm:py-28 lg:py-32">
        <div class="pointer-events-auto max-w-2xl">
          <span class="ylf-glass ylf-hero-shadow home-hero__badge inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white">
            <span class="home-hero__pulse" aria-hidden="true" />
            <Icon name="i-lucide-cloud-sun" class="size-4" aria-hidden="true" />
            {{ page.headline }}
          </span>
          <h1 class="ylf-dreamy-display ylf-hero-shadow mt-5 text-4xl leading-[1.15] text-white sm:text-5xl lg:text-6xl">
            <span class="sr-only">{{ headlineText }}</span>
            <span aria-hidden="true">
              <span
                v-for="(segment, segmentIndex) in headline"
                :key="segmentIndex"
                :class="{ 'ylf-home-hero__accent': segment.accent }"
              >
                <span
                  v-for="char in segment.chars"
                  :key="char.index"
                  class="home-hero__char"
                  :class="{ 'ylf-gradient-text home-hero__char--accent': segment.accent }"
                  :style="{ '--i': char.index }"
                >{{ char.text }}</span>
              </span>
            </span>
          </h1>
          <p class="ylf-hero-shadow home-hero__lead mt-5 max-w-xl text-base/relaxed text-white/90 sm:text-lg/relaxed">
            {{ page.description }}
          </p>
          <div class="home-hero__actions mt-7 flex flex-wrap items-center gap-2.5 sm:mt-8">
            <AppButton
              :to="page.hero.links[0]?.to"
              :label="page.hero.links[0]?.label"
              :icon="page.hero.links[0]?.icon"
              :trailing="page.hero.links[0]?.trailing"
              size="lg"
              variant="hero"
              class="rounded-[var(--ylf-radius)] font-semibold"
            />
            <AppButton
              v-if="accountAction"
              :to="accountAction.to"
              :label="accountAction.label"
              :icon="accountAction.icon"
              size="lg"
              color="neutral"
              variant="outline"
              class="ylf-glass-btn rounded-[var(--ylf-radius)]"
            />
          </div>
        </div>
      </AppContainer>
      <a href="#home-apps" class="home-hero__scroll" aria-label="向下浏览应用" @click.prevent="scrollToApps">
        <span aria-hidden="true" />
      </a>
    </section>

    <div class="home-page__body">
      <LazyHomeAppShowcase />

      <HomeJourney :journey="journey" />

      <AppContainer class="pb-16 sm:pb-24">
        <HomeCta v-bind="cta" />
      </AppContainer>
    </div>
  </div>
</template>

<style scoped>
/* 顶部六色进度条：随页面滚动展开，只在支持滚动驱动动画的浏览器中出现。 */
.home-progress {
  display: none;
}

@supports (animation-timeline: scroll()) {
  .home-progress {
    position: fixed;
    z-index: 60;
    top: 0;
    left: 0;
    display: block;
    width: 100%;
    height: 3px;
    background: linear-gradient(90deg, var(--ylf-spectrum-stops));
    transform-origin: 0 50%;
    animation: home-progress linear both;
    animation-timeline: scroll(root);
  }
}

@keyframes home-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

.ylf-home-hero__accent {
  position: relative;
  display: inline-block;
  /* Transparent gradient glyphs also expose an inherited text shadow. */
  text-shadow: none;
}

/* 「乐趣」下方画出一道六色彩虹，标题落定后再从左向右展开。 */
.ylf-home-hero__accent::after {
  content: '';
  position: absolute;
  right: 0.06em;
  bottom: -0.02em;
  left: 0.06em;
  height: 0.12em;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--ylf-spectrum-stops));
  transform-origin: 0 50%;
  animation: home-underline 900ms var(--ylf-ease-spring) 1150ms backwards;
}

.home-hero__char {
  display: inline-block;
  animation: home-char-in 900ms var(--ylf-ease-spring) calc(var(--i) * 60ms + 120ms) backwards;
}

.home-hero__char--accent {
  background-image: linear-gradient(115deg, #fff1b8, #ffd4b0);
  text-shadow: none;
  cursor: default;
}

.dark .home-hero__char--accent {
  background-image: linear-gradient(115deg, #fff4c9, #ffe0cc);
}

@media (hover: hover) and (pointer: fine) {
  .home-hero__char--accent:hover {
    animation: home-char-jelly 700ms var(--ylf-ease-standard);
  }
}

.home-hero__badge,
.home-hero__lead,
.home-hero__actions {
  animation: home-rise 900ms var(--ylf-ease-spring) backwards;
}

.home-hero__lead {
  animation-delay: 650ms;
}

.home-hero__actions {
  animation-delay: 800ms;
}

.home-hero__pulse {
  position: relative;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--ylf-palette-green);
}

.home-hero__pulse::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  animation: home-pulse 2s ease-out infinite;
}

.home-hero__scroll {
  position: absolute;
  z-index: 6;
  bottom: 1.75rem;
  left: 50%;
  display: none;
  width: 1.6rem;
  height: 2.5rem;
  margin-left: -0.8rem;
  border: 2px solid color-mix(in srgb, var(--ui-text-muted) 55%, transparent);
  border-radius: 999px;
  transition: border-color var(--ylf-duration-fast) var(--ylf-ease-standard);
}

.home-hero__scroll span {
  position: absolute;
  top: 0.45rem;
  left: 50%;
  width: 0.25rem;
  height: 0.5rem;
  margin-left: -0.125rem;
  border-radius: 999px;
  background: var(--ui-primary);
  animation: home-scroll-cue 1.8s var(--ylf-ease-standard) infinite;
}

.home-hero__scroll:hover {
  border-color: var(--ui-primary);
}

@media (min-width: 1024px) {
  .home-hero__scroll {
    display: block;
  }
}

/* 首屏天空不在页面边缘戛然而止：hero 先淡入与天色相接的余晖，
   正文区从同一颜色开始，再慢慢回到页面底色。 */
.home-page {
  --home-page-top: #e8f2fd;
}

.dark .home-page {
  --home-page-top: #1c1a3a;
}

.home-page__body {
  background: linear-gradient(to bottom, var(--home-page-top) 0, var(--ui-bg) 30rem) no-repeat;
}

.dark .home-page__body {
  background:
    radial-gradient(1px 1px at 12% 4rem, rgb(255 240 225 / 55%), transparent),
    radial-gradient(1px 1px at 28% 14rem, rgb(255 240 225 / 35%), transparent),
    radial-gradient(1.5px 1.5px at 47% 2rem, rgb(255 240 225 / 45%), transparent),
    radial-gradient(1px 1px at 66% 10rem, rgb(255 240 225 / 40%), transparent),
    radial-gradient(1.5px 1.5px at 83% 5rem, rgb(255 240 225 / 50%), transparent),
    radial-gradient(1px 1px at 93% 18rem, rgb(255 240 225 / 30%), transparent),
    linear-gradient(to bottom, var(--home-page-top) 0, #151a33 14rem, var(--ui-bg) 40rem);
  background-repeat: no-repeat;
}

.ylf-home-hero {
  /* 小数像素高度可能露出一条细缝，向下多盖 1px。 */
  margin-bottom: -1px;
}

.ylf-home-hero__fade {
  height: 9rem;
  background: linear-gradient(to bottom, transparent, var(--home-page-top));
}

@keyframes home-char-in {
  from {
    opacity: 0;
    transform: translateY(0.55em) rotate(-10deg) scale(0.7);
  }
}

@keyframes home-char-jelly {
  20% {
    transform: scale(1.25, 0.8) translateY(0.06em);
  }
  45% {
    transform: scale(0.85, 1.2) translateY(-0.2em) rotate(-6deg);
  }
  70% {
    transform: scale(1.06, 0.95) rotate(3deg);
  }
}

@keyframes home-underline {
  from {
    transform: scaleX(0);
  }
}

@keyframes home-rise {
  from {
    opacity: 0;
    transform: translateY(18px);
  }
}

@keyframes home-pulse {
  from {
    opacity: 0.7;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(3);
  }
}

@keyframes home-scroll-cue {
  0% {
    opacity: 0;
    transform: translateY(-2px);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translateY(12px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-progress,
  .ylf-home-hero__accent::after,
  .home-hero__char,
  .home-hero__badge,
  .home-hero__lead,
  .home-hero__actions,
  .home-hero__pulse::after,
  .home-hero__scroll span {
    animation: none !important;
  }

  .home-progress {
    display: none;
  }
}
</style>
