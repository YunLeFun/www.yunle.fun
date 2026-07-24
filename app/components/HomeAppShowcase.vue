<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { computed, onMounted, shallowRef } from 'vue'
import AppCloudMap from '~/components/apps/AppCloudMap.vue'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import { normalizeExplorerApps } from '~/utils/app-explorer'

const apps = shallowRef<AppRecord[]>([])
const loading = shallowRef(true)
const error = shallowRef<string | null>(null)
const { getOfficialApps } = useApps()
const { authReady, checkAuthStatus } = useTcbAuthSession()
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const normalizedApps = computed(() => normalizeExplorerApps(apps.value))

async function loadApps() {
  loading.value = true
  error.value = null

  try {
    if (!authReady.value)
      await checkAuthStatus()

    apps.value = (await getOfficialApps()).filter(app => app.isPublic)
  }
  catch {
    error.value = '应用云图暂时没有加载成功，请稍后重试。'
  }
  finally {
    loading.value = false
  }
}

function browseApps() {
  return navigateTo('/explore')
}

onMounted(loadApps)
</script>

<template>
  <section class="home-app-showcase" aria-labelledby="home-app-showcase-title">
    <UContainer>
      <header class="home-app-showcase__header">
        <div>
          <p class="home-app-showcase__eyebrow">
            <UIcon name="i-lucide-cloud-sun" aria-hidden="true" />
            应用发现
          </p>
          <h2 id="home-app-showcase-title">
            看见正在开放的应用
          </h2>
          <p>
            云图直接读取应用市场中的官方公开应用。聚焦或悬停在应用上，可以查看它的名称与简介。
          </p>
        </div>

        <UButton
          to="/explore"
          label="打开应用市场"
          icon="i-lucide-arrow-up-right"
          trailing
          color="neutral"
          variant="outline"
          size="lg"
        />
      </header>

      <div
        v-if="loading"
        class="home-app-showcase__state"
        role="status"
        aria-live="polite"
      >
        <UIcon name="i-lucide-loader-circle" class="animate-spin" aria-hidden="true" />
        <div>
          <strong>正在连接应用市场</strong>
          <span>公开应用加载完成后会在这里组成云图。</span>
        </div>
      </div>

      <div
        v-else-if="error"
        class="home-app-showcase__state"
        role="alert"
      >
        <UIcon name="i-lucide-cloud-off" aria-hidden="true" />
        <div>
          <strong>{{ error }}</strong>
          <span>你仍然可以直接进入应用市场查看。</span>
        </div>
        <div class="home-app-showcase__state-actions">
          <UButton label="重新加载" icon="i-lucide-refresh-cw" @click="loadApps" />
          <UButton to="/explore" label="浏览应用" color="neutral" variant="outline" />
        </div>
      </div>

      <div
        v-else-if="!normalizedApps.length"
        class="home-app-showcase__state"
        role="status"
      >
        <UIcon name="i-lucide-cloud" aria-hidden="true" />
        <div>
          <strong>公开应用正在整理</strong>
          <span>应用开放后会自动出现在这里。</span>
        </div>
        <UButton to="/explore" label="前往应用市场" color="neutral" variant="outline" />
      </div>

      <AppCloudMap
        v-else
        :apps="normalizedApps"
        :reduced-motion="prefersReducedMotion"
        @scroll-to-grid="browseApps"
      />
    </UContainer>
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

.home-app-showcase__state {
  display: flex;
  min-height: 30rem;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--ui-border);
  border-radius: 1.75rem;
  padding: 2rem;
  background: linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg)), var(--ui-bg-elevated));
  color: var(--ui-text-muted);
  text-align: center;
}

.home-app-showcase__state > svg {
  width: 2rem;
  height: 2rem;
  color: var(--ui-primary);
}

.home-app-showcase__state > div:not(.home-app-showcase__state-actions) {
  display: grid;
  gap: 0.35rem;
}

.home-app-showcase__state strong {
  color: var(--ui-text-highlighted);
  font-size: 1rem;
}

.home-app-showcase__state span {
  font-size: 0.9rem;
}

.home-app-showcase__state-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}

@media (min-width: 768px) {
  .home-app-showcase__header {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
