<script setup lang="ts">
import HomeJourney from '~/components/home/HomeJourney.vue'
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
              variant="hero"
            />
            <AppButton
              v-if="accountAction"
              :to="accountAction.to"
              :label="accountAction.label"
              :icon="accountAction.icon"
              size="xl"
              color="neutral"
              variant="outline"
              class="ylf-glass-btn rounded-full"
            />
          </div>
        </div>
      </AppContainer>
    </section>

    <LazyHomeAppShowcase />

    <HomeJourney :journey="journey" />

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

.home-cta {
  margin-top: 1rem;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  background: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg-elevated));
  box-shadow: none;
}
</style>
