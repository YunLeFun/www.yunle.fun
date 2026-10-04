<script setup lang="ts">
import type { SsoAccountState, SsoExplorerApp } from '~/types/app-explorer'
import { ArrowLeftRightIcon } from '@lucide/vue'
import { computed, onMounted, shallowRef } from 'vue'
import HomeAppCard from './HomeAppCard.vue'

const props = withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  account: SsoAccountState
  reducedMotion?: boolean
}>(), { reducedMotion: false })

const appRail = shallowRef<HTMLElement | null>(null)
const { arrivedState, measure } = useScroll(appRail)
useResizeObserver(appRail, measure)
onMounted(measure)

const accountLabel = computed(() => {
  if (props.account.status === 'authenticated')
    return '已连接 · 个人中心'
  if (props.account.status === 'pending')
    return '正在确认账号'
  return '登录后连接应用'
})

function scrollApps(direction: -1 | 1) {
  const rail = appRail.value
  if (!rail)
    return

  const card = rail.firstElementChild as HTMLElement | null
  const step = card ? card.offsetWidth + Number.parseFloat(getComputedStyle(rail).columnGap) : rail.clientWidth
  rail.scrollBy({ left: direction * step, behavior: props.reducedMotion ? 'auto' : 'smooth' })
}
</script>

<template>
  <div class="home-app-gallery">
    <header class="home-app-gallery__header">
      <div class="home-app-gallery__intro">
        <span class="home-app-gallery__mark" aria-hidden="true">
          <Icon name="i-lucide-cloud" />
        </span>
        <div>
          <h3>每一朵云，都有新发现</h3>
          <p>{{ apps.length }} 个应用，使用同一个云乐坊账号</p>
        </div>
      </div>

      <NuxtLink :to="account.to" class="home-app-gallery__account" data-testid="sso-account-cloud">
        <MemberAvatar
          v-if="account.status === 'authenticated'"
          :src="account.avatar || '/app-icons/home-brand-mark.svg'"
          :alt="account.displayName"
          size="sm"
        />
        <img v-else src="/app-icons/home-brand-mark.svg" alt="" width="36" height="36">
        <span>
          <strong>{{ account.status === 'authenticated' ? account.displayName : '云乐坊账号' }}</strong>
          <span>{{ accountLabel }}</span>
        </span>
        <Icon name="i-lucide-arrow-up-right" aria-hidden="true" />
      </NuxtLink>
    </header>

    <div
      ref="appRail"
      class="home-app-gallery__apps"
      role="region"
      aria-label="支持统一账号的应用，可左右滚动浏览"
      tabindex="0"
    >
      <HomeAppCard v-for="app in apps" :key="app.appId" :app="app" />
    </div>

    <footer class="home-app-gallery__footer">
      <p>
        <ArrowLeftRightIcon aria-hidden="true" />
        左右浏览，找到你的下一朵云
      </p>
      <div class="home-app-gallery__controls" aria-label="应用浏览控制">
        <button type="button" aria-label="浏览前面的应用" :disabled="arrivedState.left" @click="scrollApps(-1)">
          <Icon name="i-lucide-arrow-left" aria-hidden="true" />
        </button>
        <button type="button" aria-label="浏览后面的应用" :disabled="arrivedState.right" @click="scrollApps(1)">
          <Icon name="i-lucide-arrow-right" aria-hidden="true" />
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.home-app-gallery {
  --gallery-inset: 1.75rem;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: 2rem;
  background: color-mix(in srgb, var(--ui-primary) 3%, var(--ui-bg-muted));
  box-shadow: inset 0 1px var(--ylf-glass-highlight);
}

.home-app-gallery__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.5rem var(--gallery-inset);
}

.home-app-gallery__intro {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.home-app-gallery__mark {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  flex: none;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 14%, var(--ui-border-muted));
  border-radius: 0.9rem;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
}

.home-app-gallery__mark :deep(svg) {
  width: 1.4rem;
  height: 1.4rem;
}

.home-app-gallery__intro h3 {
  color: var(--ui-text-highlighted);
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.home-app-gallery__intro p {
  margin-top: 0.3rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}

.home-app-gallery__account {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1rem;
  padding: 0.6rem 0.85rem;
  background: var(--ui-bg-elevated);
  transition: border-color 180ms ease;
}

.home-app-gallery__account > img {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 0.75rem;
}

.home-app-gallery__account > span {
  display: grid;
  min-width: 0;
  gap: 0.15rem;
}

.home-app-gallery__account strong {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 0.8rem;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-app-gallery__account > span > span {
  color: var(--ui-primary);
  font-size: 0.65rem;
}

.home-app-gallery__account > :deep(svg) {
  width: 1rem;
  height: 1rem;
  flex: none;
  margin-left: 0.5rem;
  color: var(--ui-text-muted);
}

.home-app-gallery__account:hover {
  border-color: var(--ylf-ring);
}

.home-app-gallery__apps {
  display: grid;
  grid-auto-columns: calc((100% - 2 * var(--gallery-inset) - 3 * 0.85rem) / 4);
  grid-auto-flow: column;
  grid-template-rows: repeat(2, minmax(14rem, auto));
  gap: 0.85rem;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  padding: 0.25rem var(--gallery-inset) 0.65rem;
  scroll-padding-inline: var(--gallery-inset);
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
}

.home-app-gallery__apps::-webkit-scrollbar {
  display: none;
}

.home-app-gallery__apps > * {
  scroll-snap-align: start;
}

.home-app-gallery__apps:focus-visible {
  outline: 2px solid var(--ylf-ring);
  outline-offset: -2px;
}

.home-app-gallery__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem var(--gallery-inset) 1.1rem;
}

.home-app-gallery__footer p {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}

.home-app-gallery__footer p :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.home-app-gallery__controls {
  display: flex;
  gap: 0.5rem;
}

.home-app-gallery__controls button {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  transition:
    background-color 180ms ease,
    border-color 180ms ease;
}

.home-app-gallery__controls button:hover:not(:disabled) {
  border-color: var(--ylf-ring);
  background: var(--ylf-surface-hover);
}

.home-app-gallery__controls button:disabled {
  opacity: 0.35;
}

.home-app-gallery__controls :deep(svg) {
  width: 1rem;
  height: 1rem;
}

@media (max-width: 1023px) {
  .home-app-gallery__apps {
    grid-auto-columns: calc((100% - 2 * var(--gallery-inset) - 2 * 0.85rem) / 3);
  }
}

@media (max-width: 767px) {
  .home-app-gallery {
    --gallery-inset: 1rem;
    border-radius: 1.5rem;
  }

  .home-app-gallery__header {
    align-items: stretch;
    flex-direction: column;
    gap: 1.15rem;
    padding-block: 1.25rem;
  }

  .home-app-gallery__intro h3 {
    font-size: 0.95rem;
  }

  .home-app-gallery__account > span {
    flex: 1;
  }

  .home-app-gallery__apps {
    grid-auto-columns: min(72vw, 16rem);
    grid-template-rows: minmax(14rem, auto);
  }

  .home-app-gallery__footer p {
    max-width: 12rem;
    font-size: 0.7rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-app-gallery__account,
  .home-app-gallery__controls button {
    transition: none;
  }
}
</style>
