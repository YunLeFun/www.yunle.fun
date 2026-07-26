<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import { shallowRef, useId, watch } from 'vue'

const props = defineProps<{
  app: SsoExplorerApp
  active?: boolean
}>()

const emit = defineEmits<{
  activate: [appId: string]
  deactivate: [appId: string]
}>()

const logoFailed = shallowRef(false)
const gradientId = `sso-app-cloud-${useId().replaceAll(':', '')}`

watch(() => props.app.logoUrl, () => {
  logoFailed.value = false
})
</script>

<template>
  <div
    class="sso-app-cloud"
    :class="{ 'sso-app-cloud--active': active }"
    :style="{ '--sso-app-accent': app.accent }"
    :data-testid="`sso-app-${app.appId}`"
  >
    <a
      :href="app.origin"
      target="_blank"
      rel="noopener noreferrer"
      class="sso-app-cloud__link"
      :aria-label="`${app.name}，支持统一账号，在新标签页打开`"
      @focus="emit('activate', app.appId)"
      @blur="emit('deactivate', app.appId)"
      @mouseenter="emit('activate', app.appId)"
      @mouseleave="emit('deactivate', app.appId)"
    >
      <svg
        class="sso-app-cloud__shape"
        viewBox="0 0 260 122"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="var(--ylf-sso-cloud-top)" />
            <stop offset="0.68" stop-color="var(--ylf-sso-cloud-middle-soft)" />
            <stop offset="1" stop-color="var(--ylf-sso-cloud-base)" />
          </linearGradient>
        </defs>
        <path
          d="M49 110C25 110 10 96 10 76C10 56 25 42 44 40C50 22 66 12 84 13C95 3 109 0 122 5C135 10 144 21 146 35C164 27 185 34 195 49C220 48 240 65 241 86C242 100 231 111 213 111H49Z"
          :fill="`url(#${gradientId})`"
        />
      </svg>

      <span class="sso-app-cloud__content">
        <span class="sso-app-cloud__logo" aria-hidden="true">
          <img
            v-if="!logoFailed"
            :src="app.logoUrl"
            alt=""
            loading="lazy"
            @error="logoFailed = true"
          >
          <span v-else>{{ app.fallbackMark }}</span>
        </span>

        <span class="sso-app-cloud__copy">
          <strong>{{ app.name }}</strong>
          <span class="sso-app-cloud__status">
            <UIcon name="i-lucide-badge-check" aria-hidden="true" />
            统一账号
          </span>
        </span>

        <UIcon
          name="i-lucide-external-link"
          class="sso-app-cloud__external"
          aria-hidden="true"
        />
      </span>
    </a>

    <NuxtLink
      v-if="app.detailSlug"
      :to="`/apps/${app.detailSlug}`"
      class="sso-app-cloud__detail"
      :aria-label="`查看 ${app.name} 的站内详情`"
      title="查看站内详情"
      @focus="emit('activate', app.appId)"
      @blur="emit('deactivate', app.appId)"
    >
      <UIcon name="i-lucide-info" aria-hidden="true" />
    </NuxtLink>
  </div>
</template>

<style scoped>
.sso-app-cloud {
  position: relative;
  width: 15rem;
  height: 7.1rem;
  color: var(--ylf-sso-ink);
  transition:
    filter 180ms ease,
    transform 180ms ease;
}

.sso-app-cloud__link {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4.5rem 4.5rem 2.25rem 2.25rem;
  outline: none;
}

.sso-app-cloud__shape {
  position: absolute;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 13px 18px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 20%, transparent));
  inset: 0;
}

.sso-app-cloud__content {
  position: absolute;
  display: grid;
  grid-template-columns: 2.55rem minmax(0, 1fr) 0.9rem;
  gap: 0.65rem;
  align-items: center;
  padding: 0 1.1rem 0 1rem;
  inset: 2.4rem 0 0.55rem;
}

.sso-app-cloud__logo {
  display: grid;
  width: 2.55rem;
  height: 2.55rem;
  overflow: hidden;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--sso-app-accent) 30%, var(--ylf-sso-cloud-top));
  border-radius: 0.82rem;
  background: color-mix(in srgb, var(--sso-app-accent) 88%, var(--ylf-sso-cloud-top));
  box-shadow: 0 7px 18px color-mix(in srgb, var(--sso-app-accent) 25%, transparent);
  color: var(--ylf-sso-cloud-top);
  font-size: 0.68rem;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.sso-app-cloud__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sso-app-cloud__copy {
  display: grid;
  min-width: 0;
  gap: 0.28rem;
}

.sso-app-cloud__copy strong {
  overflow: hidden;
  font-size: 0.88rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sso-app-cloud__status {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
  color: var(--ylf-sso-accent-strong);
  font-size: 0.62rem;
  font-weight: 700;
  white-space: nowrap;
}

.sso-app-cloud__status :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}

.sso-app-cloud__external {
  width: 0.82rem;
  height: 0.82rem;
  color: color-mix(in srgb, var(--ylf-sso-ink) 38%, transparent);
  transition: color 180ms ease;
}

.sso-app-cloud__detail {
  position: absolute;
  z-index: 3;
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-top) 82%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ylf-sso-cloud-top) 88%, transparent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 18%, transparent);
  color: var(--ylf-sso-accent-strong);
  right: 0.3rem;
  top: 1.5rem;
}

.sso-app-cloud__detail :deep(svg) {
  width: 0.88rem;
  height: 0.88rem;
}

.sso-app-cloud:hover,
.sso-app-cloud:focus-within,
.sso-app-cloud--active {
  z-index: 8;
  filter: drop-shadow(0 0 16px color-mix(in srgb, var(--sso-app-accent) 38%, transparent));
  transform: translateY(-0.35rem) scale(1.025);
}

.sso-app-cloud__link:focus-visible,
.sso-app-cloud__detail:focus-visible {
  outline: 3px solid var(--ylf-sso-cloud-top);
  outline-offset: 3px;
}

.sso-app-cloud:hover .sso-app-cloud__external,
.sso-app-cloud:focus-within .sso-app-cloud__external {
  color: var(--ylf-sso-accent-strong);
}

@media (prefers-reduced-motion: reduce) {
  .sso-app-cloud,
  .sso-app-cloud__external {
    transition: none;
  }

  .sso-app-cloud:hover,
  .sso-app-cloud:focus-within,
  .sso-app-cloud--active {
    transform: none;
  }
}
</style>
