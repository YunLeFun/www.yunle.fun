<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import { shallowRef, watch } from 'vue'

const props = defineProps<{
  app: SsoExplorerApp
  active?: boolean
}>()

const emit = defineEmits<{
  activate: [appId: string]
  deactivate: [appId: string]
}>()

const logoFailed = shallowRef(false)

watch(() => props.app.logoUrl, () => {
  logoFailed.value = false
})
</script>

<template>
  <div
    class="sso-app-node"
    :class="{ 'sso-app-node--active': active }"
    :style="{ '--sso-app-accent': app.accent }"
    :data-testid="`sso-app-${app.appId}`"
  >
    <span class="sso-app-node__signal" aria-hidden="true" />

    <a
      :href="app.origin"
      target="_blank"
      rel="noopener noreferrer"
      class="sso-app-node__link"
      :aria-label="`${app.name}，支持统一账号，在新标签页打开`"
      @focus="emit('activate', app.appId)"
      @blur="emit('deactivate', app.appId)"
      @mouseenter="emit('activate', app.appId)"
      @mouseleave="emit('deactivate', app.appId)"
    >
      <span class="sso-app-node__logo" aria-hidden="true">
        <img
          v-if="!logoFailed"
          :src="app.logoUrl"
          alt=""
          loading="lazy"
          @error="logoFailed = true"
        >
        <span v-else>{{ app.fallbackMark }}</span>
      </span>

      <span class="sso-app-node__copy">
        <strong>{{ app.name }}</strong>
        <span class="sso-app-node__status">
          <UIcon name="i-lucide-badge-check" aria-hidden="true" />
          统一账号
        </span>
      </span>

      <UIcon
        name="i-lucide-arrow-up-right"
        class="sso-app-node__external"
        aria-hidden="true"
      />
    </a>

    <NuxtLink
      v-if="app.detailSlug"
      :to="`/apps/${app.detailSlug}`"
      class="sso-app-node__detail"
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
.sso-app-node {
  position: relative;
  display: flex;
  width: 15rem;
  height: 4.9rem;
  gap: 0.25rem;
  align-items: center;
  padding: 0.55rem 0.55rem 0.55rem 0.78rem;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-border) 46%, transparent);
  border-radius: 1.45rem;
  background: linear-gradient(
    145deg,
    color-mix(in srgb, var(--ylf-sso-cloud-top) 96%, transparent),
    color-mix(in srgb, var(--ylf-sso-cloud-middle-soft) 88%, transparent)
  );
  box-shadow:
    0 17px 34px -22px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 68%, transparent),
    0 2px 8px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 10%, transparent),
    inset 0 1px color-mix(in srgb, var(--ylf-sso-cloud-top) 90%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ylf-sso-ink);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.sso-app-node__signal {
  position: absolute;
  width: 0.22rem;
  border-radius: 999px;
  background: var(--sso-app-accent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--sso-app-accent) 42%, transparent);
  inset: 1.05rem auto 1.05rem 0.38rem;
  opacity: 0.78;
  transition:
    inset 180ms ease,
    opacity 180ms ease;
}

.sso-app-node__link {
  position: relative;
  display: grid;
  min-width: 0;
  height: 100%;
  flex: 1;
  grid-template-columns: 2.75rem minmax(0, 1fr) 0.95rem;
  gap: 0.7rem;
  align-items: center;
  padding: 0.2rem 0.3rem 0.2rem 0.12rem;
  border-radius: 1rem;
  outline: none;
}

.sso-app-node__logo {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  overflow: hidden;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--sso-app-accent) 34%, var(--ylf-sso-cloud-top));
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--sso-app-accent) 86%, var(--ylf-sso-cloud-top));
  box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--sso-app-accent) 58%, transparent);
  color: var(--ylf-sso-cloud-top);
  font-size: 0.68rem;
  font-weight: 850;
  letter-spacing: -0.02em;
}

.sso-app-node__logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.sso-app-node__copy {
  display: grid;
  min-width: 0;
  gap: 0.34rem;
}

.sso-app-node__copy strong {
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 820;
  letter-spacing: -0.02em;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sso-app-node__status {
  display: inline-flex;
  width: max-content;
  gap: 0.25rem;
  align-items: center;
  padding: 0.14rem 0.42rem;
  border: 1px solid color-mix(in srgb, var(--sso-app-accent) 13%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--sso-app-accent) 8%, transparent);
  color: var(--ylf-sso-accent-strong);
  font-size: 0.62rem;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.sso-app-node__status :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}

.sso-app-node__external {
  width: 0.9rem;
  height: 0.9rem;
  color: color-mix(in srgb, var(--ylf-sso-ink) 38%, transparent);
  transition: color 180ms ease;
}

.sso-app-node__detail {
  display: grid;
  width: 2.15rem;
  height: 2.15rem;
  flex: none;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-border) 30%, transparent);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--ylf-sso-cloud-top) 62%, transparent);
  color: var(--ylf-sso-accent-strong);
  outline: none;
  transition:
    background-color 180ms ease,
    border-color 180ms ease;
}

.sso-app-node__detail :deep(svg) {
  width: 0.88rem;
  height: 0.88rem;
}

.sso-app-node:hover,
.sso-app-node:focus-within,
.sso-app-node--active {
  z-index: 8;
  border-color: color-mix(in srgb, var(--sso-app-accent) 38%, var(--ylf-sso-cloud-top));
  box-shadow:
    0 21px 38px -22px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 74%, transparent),
    0 4px 12px color-mix(in srgb, var(--sso-app-accent) 12%, transparent),
    inset 0 1px color-mix(in srgb, var(--ylf-sso-cloud-top) 94%, transparent);
  transform: translateY(-0.22rem);
}

.sso-app-node:hover .sso-app-node__signal,
.sso-app-node:focus-within .sso-app-node__signal,
.sso-app-node--active .sso-app-node__signal {
  inset-block: 0.78rem;
  opacity: 1;
}

.sso-app-node__link:focus-visible,
.sso-app-node__detail:focus-visible {
  outline: 3px solid var(--ylf-sso-cloud-top);
  outline-offset: 3px;
}

.sso-app-node:hover .sso-app-node__external,
.sso-app-node:focus-within .sso-app-node__external {
  color: var(--ylf-sso-accent-strong);
}

.sso-app-node__detail:hover {
  border-color: color-mix(in srgb, var(--sso-app-accent) 30%, transparent);
  background: color-mix(in srgb, var(--sso-app-accent) 9%, var(--ylf-sso-cloud-top));
}

@media (prefers-reduced-motion: reduce) {
  .sso-app-node,
  .sso-app-node__signal,
  .sso-app-node__external,
  .sso-app-node__detail {
    transition: none;
  }

  .sso-app-node:hover,
  .sso-app-node:focus-within,
  .sso-app-node--active {
    transform: none;
  }
}
</style>
