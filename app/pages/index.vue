<script setup lang="ts">
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
  <div>
    <section class="ylf-home-hero relative isolate overflow-hidden">
      <SkyScene :sun="false" class="pointer-events-none" />
      <div class="ylf-home-hero__scrim pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
      <div class="ylf-home-hero__fade pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28" aria-hidden="true" />
      <AppContainer class="relative z-[2] py-20 sm:py-28 lg:py-32">
        <div class="max-w-2xl">
          <span class="ylf-glass ylf-hero-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white">
            <Icon name="i-lucide-cloud-sun" class="size-4" aria-hidden="true" />
            {{ page.headline }}
          </span>
          <h1 class="ylf-dreamy-display ylf-hero-shadow mt-5 text-4xl leading-[1.15] text-white sm:text-5xl lg:text-6xl">
            云之彼端，<span class="ylf-gradient-text ylf-gradient-text--sun">乐趣</span>无限
          </h1>
          <p class="ylf-hero-shadow mt-5 max-w-xl text-base/relaxed text-white/90 sm:text-lg/relaxed">
            {{ page.description }}
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <AppButton
              :to="page.hero.links[0]?.to"
              :label="page.hero.links[0]?.label"
              :icon="page.hero.links[0]?.icon"
              :trailing="page.hero.links[0]?.trailing"
              size="xl"
              class="ylf-brand-btn"
            />
            <AppButton
              v-if="accountAction"
              :to="accountAction.to"
              :label="accountAction.label"
              :icon="accountAction.icon"
              size="xl"
              color="neutral"
              variant="outline"
              class="ylf-glass-btn"
            />
          </div>
        </div>
      </AppContainer>
    </section>

    <LazyHomeAppShowcase />

    <section class="home-journey" aria-labelledby="home-journey-title">
      <AppContainer>
        <header class="home-journey__header">
          <p>{{ journey.headline }}</p>
          <h2 id="home-journey-title">
            {{ journey.title }}
          </h2>
          <span>{{ journey.description }}</span>
        </header>

        <ol class="home-journey__steps">
          <li v-for="(item, index) in journey.items" :key="item.title">
            <span class="home-journey__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="home-journey__icon" aria-hidden="true">
              <Icon :name="item.icon" />
            </span>
            <div>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description }}</p>
              <NuxtLink v-if="item.to" :to="item.to">
                {{ item.linkLabel }}
                <Icon name="i-lucide-arrow-right" aria-hidden="true" />
              </NuxtLink>
            </div>
          </li>
        </ol>
      </AppContainer>
    </section>

    <AppContainer class="pb-16 sm:pb-24">
      <AppPageCta
        v-bind="cta"
        variant="subtle"
        class="home-cta"
      />
    </AppContainer>
  </div>
</template>

<style scoped>
.ylf-home-hero__scrim {
  background: linear-gradient(
    100deg,
    rgba(8, 32, 74, 0.5) 0%,
    rgba(8, 32, 74, 0.24) 42%,
    rgba(8, 32, 74, 0.04) 66%,
    transparent 80%
  );
}

.ylf-home-hero__fade {
  background: linear-gradient(to bottom, transparent, var(--ui-bg));
}

.home-journey {
  border-block: 1px solid var(--ui-border-muted);
  padding-block: clamp(4rem, 9vw, 7rem);
  background: color-mix(in srgb, var(--ui-bg-muted) 62%, transparent);
}

.home-journey__header {
  max-width: 45rem;
}

.home-journey__header > p {
  color: var(--ylf-dopa-cyan);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.home-journey__header h2 {
  margin-top: 0.55rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(2rem, 5vw, 3.35rem);
  font-weight: 850;
  letter-spacing: -0.045em;
  line-height: 1.1;
  text-wrap: balance;
}

.home-journey__header span {
  display: block;
  margin-top: 0.9rem;
  color: var(--ui-text-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.home-journey__steps {
  display: grid;
  gap: 1rem;
  margin: 2.25rem 0 0;
  padding: 0;
  counter-reset: none;
  list-style: none;
}

.home-journey__steps li {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1rem;
  min-height: 12rem;
  border: 1px solid var(--ui-border);
  border-radius: 1.25rem;
  padding: 1.25rem;
  background: var(--ui-bg-elevated);
  box-shadow: 0 1.25rem 3.5rem -3rem color-mix(in srgb, var(--ui-text-highlighted) 32%, transparent);
}

.home-journey__index {
  position: absolute;
  top: 1rem;
  right: 1rem;
  color: var(--ui-text-dimmed);
  font-family: var(--ylf-font-round);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.home-journey__icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, transparent);
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg-elevated));
  color: var(--ui-primary);
}

.home-journey__icon svg {
  width: 1.25rem;
  height: 1.25rem;
}

.home-journey__steps h3 {
  padding-right: 1.5rem;
  color: var(--ui-text-highlighted);
  font-size: 1.05rem;
  font-weight: 750;
}

.home-journey__steps p {
  margin-top: 0.55rem;
  color: var(--ui-text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.home-journey__steps a {
  display: inline-flex;
  gap: 0.35rem;
  align-items: center;
  min-height: 2.75rem;
  margin-top: 0.85rem;
  color: var(--ui-primary);
  font-size: 0.85rem;
  font-weight: 700;
}

.home-journey__steps a svg {
  width: 0.9rem;
  height: 0.9rem;
  transition: transform 180ms ease;
}

.home-journey__steps a:hover svg {
  transform: translateX(2px);
}

.home-cta {
  margin-top: clamp(4rem, 8vw, 6rem);
  overflow: hidden;
  border: 1px solid var(--ui-border);
}

@media (min-width: 768px) {
  .home-journey__steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .home-journey__steps li {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-journey__steps a svg {
    transition: none;
  }

  .home-journey__steps a:hover svg {
    transform: none;
  }
}
</style>
