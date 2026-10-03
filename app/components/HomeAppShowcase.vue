<script setup lang="ts">
import { defineAsyncComponent, shallowRef } from 'vue'
import { useSsoAccountState } from '~/composables/useSsoAccountState'
import { ssoExplorerApps } from '~/config/sso-explorer'

const HomeAppGallery = defineAsyncComponent({
  loader: () => import('~/components/home/HomeAppGallery.vue'),
  suspensible: false,
})

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const accountState = useSsoAccountState('/')
const galleryHost = shallowRef<HTMLElement | null>(null)
const shouldRenderGallery = shallowRef(false)

const { stop: stopObservingGallery } = useIntersectionObserver(
  galleryHost,
  ([entry]) => {
    if (!entry?.isIntersecting)
      return

    shouldRenderGallery.value = true
    stopObservingGallery()
  },
  { rootMargin: '0px 0px -20% 0px' },
)
</script>

<template>
  <section class="home-app-showcase" aria-labelledby="home-app-showcase-title">
    <AppContainer>
      <header class="home-app-showcase__header">
        <div>
          <p class="home-app-showcase__eyebrow">
            <Icon name="i-lucide-cloud-sun" aria-hidden="true" />
            统一账号生态
          </p>
          <h2 id="home-app-showcase-title">
            一个账号，连接每一朵云
          </h2>
          <p>
            创作、探索，或是给日常添一点乐趣。带着同一个账号，去不同的云里逛逛。
          </p>
        </div>

        <AppButton
          to="/explore"
          label="浏览全部应用"
          icon="i-lucide-arrow-up-right"
          trailing
          color="neutral"
          variant="ghost"
          size="lg"
        />
      </header>

      <div ref="galleryHost" class="home-app-showcase__map">
        <HomeAppGallery
          v-if="shouldRenderGallery"
          :apps="ssoExplorerApps"
          :account="accountState"
          :reduced-motion="prefersReducedMotion"
        />
        <div
          v-else
          class="home-app-showcase__map-placeholder"
          data-testid="sso-map-placeholder"
          aria-hidden="true"
        >
          <Icon name="i-lucide-cloud-sun" />
        </div>
      </div>
    </AppContainer>
  </section>
</template>

<style scoped>
.home-app-showcase {
  padding-block: clamp(3.5rem, 7vw, 6rem);
}

.home-app-showcase__header {
  display: grid;
  gap: 1.5rem;
  align-items: end;
  margin-bottom: 2rem;
}

.home-app-showcase__header > div {
  max-width: 40rem;
}

.home-app-showcase__eyebrow {
  display: inline-flex;
  gap: 0.45rem;
  align-items: center;
  color: var(--ui-primary);
  font-size: 0.75rem;
  font-weight: 650;
}

.home-app-showcase__eyebrow svg {
  width: 1rem;
  height: 1rem;
}

.home-app-showcase__header h2 {
  margin-top: 0.55rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(1.85rem, 3.5vw, 2.75rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.3;
  text-wrap: balance;
}

.home-app-showcase__header p:last-child {
  margin-top: 0.85rem;
  color: var(--ui-text-muted);
  font-size: 0.9rem;
  line-height: 1.75;
}

.home-app-showcase__map {
  content-visibility: auto;
  contain-intrinsic-block-size: 38rem;
}

.home-app-showcase__map-placeholder {
  display: grid;
  min-height: 38rem;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: 2rem;
  background: color-mix(in srgb, var(--ui-primary) 3%, var(--ui-bg-muted));
  color: var(--ui-primary);
}

.home-app-showcase__map-placeholder svg {
  width: 3rem;
  height: 3rem;
}

@media (max-width: 767px) {
  .home-app-showcase__map {
    contain-intrinsic-block-size: 29rem;
  }

  .home-app-showcase__map-placeholder {
    min-height: 29rem;
    border-radius: 1.5rem;
  }

  .home-app-showcase__header {
    gap: 0.85rem;
  }

  .home-app-showcase__header > :deep(a) {
    justify-self: start;
    margin-left: -0.75rem;
  }
}

@media (min-width: 768px) {
  .home-app-showcase__header {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
