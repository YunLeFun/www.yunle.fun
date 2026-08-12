<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { useSsoAccountState } from '~/composables/useSsoAccountState'
import { ssoExplorerApps } from '~/config/sso-explorer'

const AppSsoCloudMap = defineAsyncComponent({
  loader: () => import('~/components/apps/AppSsoCloudMap.vue'),
  suspensible: false,
})

const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const accountState = useSsoAccountState('/')
const mapHost = ref<HTMLElement | null>(null)
const shouldRenderMap = ref(false)

const { stop: stopObservingMap } = useIntersectionObserver(
  mapHost,
  ([entry]) => {
    if (!entry?.isIntersecting)
      return

    shouldRenderMap.value = true
    stopObservingMap()
  },
  { rootMargin: '0px 0px -20% 0px' },
)

function browseApps() {
  return navigateTo('/explore')
}
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
            云图展示已经接入云乐坊统一账号的应用；全部公开应用仍可在应用市场中浏览。
          </p>
        </div>

        <AppButton
          to="/explore"
          label="浏览全部应用"
          icon="i-lucide-arrow-up-right"
          trailing
          color="neutral"
          variant="outline"
          size="lg"
        />
      </header>

      <div ref="mapHost" class="home-app-showcase__map">
        <AppSsoCloudMap
          v-if="shouldRenderMap"
          :apps="ssoExplorerApps"
          :account="accountState"
          :reduced-motion="prefersReducedMotion"
          @scroll-to-grid="browseApps"
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
  padding-block: clamp(4rem, 9vw, 7rem);
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, var(--ylf-dopa-cyan) 8%, transparent), transparent 26rem),
    radial-gradient(circle at 88% 72%, color-mix(in srgb, var(--ylf-dopa-violet) 7%, transparent), transparent 28rem);
}

.home-app-showcase__header {
  display: grid;
  gap: 1.5rem;
  align-items: end;
  margin-bottom: 1.75rem;
}

.home-app-showcase__header > div {
  max-width: 44rem;
}

.home-app-showcase__eyebrow {
  display: inline-flex;
  gap: 0.45rem;
  align-items: center;
  color: var(--ylf-dopa-cyan);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.home-app-showcase__eyebrow svg {
  width: 1rem;
  height: 1rem;
}

.home-app-showcase__header h2 {
  margin-top: 0.55rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 850;
  letter-spacing: -0.045em;
  line-height: 1.08;
  text-wrap: balance;
}

.home-app-showcase__header p:last-child {
  margin-top: 0.85rem;
  color: var(--ui-text-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.home-app-showcase__map {
  content-visibility: auto;
  contain-intrinsic-block-size: 34rem;
}

.home-app-showcase__map-placeholder {
  display: grid;
  min-height: 34rem;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-top) 62%, transparent);
  border-radius: 1.75rem;
  background: var(--ylf-sso-sky);
  color: color-mix(in srgb, var(--ylf-sso-accent) 72%, transparent);
}

.home-app-showcase__map-placeholder svg {
  width: 3rem;
  height: 3rem;
}

@media (max-width: 767px) {
  .home-app-showcase__map {
    contain-intrinsic-block-size: 30rem;
  }

  .home-app-showcase__map-placeholder {
    min-height: 30rem;
    border-radius: 1.45rem;
  }
}

@media (min-width: 768px) {
  .home-app-showcase__header {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
