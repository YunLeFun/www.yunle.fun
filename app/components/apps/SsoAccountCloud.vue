<script setup lang="ts">
import type { SsoAccountState } from '~/types/app-explorer'
import { useId } from 'vue'

defineProps<{ account: SsoAccountState }>()
const svgId = useId()
const gradientId = `sso-account-cloud-${svgId}`
const lightId = `sso-cloud-light-${svgId}`
const rimId = `sso-cloud-rim-${svgId}`
const cloudOutline = 'M66 202C39 202 18 183 18 158C18 134 35 114 59 110C62 83 84 63 111 64C119 36 143 18 172 18C202 18 227 40 231 70C260 72 282 95 282 123C298 132 308 148 306 165C304 187 285 202 260 202H66Z'
</script>

<template>
  <NuxtLink :to="account.to" class="sso-account-cloud" data-testid="sso-account-cloud">
    <svg class="sso-account-cloud__shape" viewBox="0 0 320 228" aria-hidden="true">
      <defs>
        <linearGradient :id="gradientId" x1="0.35" y1="0" x2="0.65" y2="1">
          <stop offset="0" stop-color="var(--account-cloud-top)" />
          <stop offset="0.55" stop-color="var(--account-cloud-middle)" />
          <stop offset="1" stop-color="var(--account-cloud-bottom)" />
        </linearGradient>
        <radialGradient :id="lightId" cx="36%" cy="24%" r="72%">
          <stop offset="0" stop-color="var(--account-cloud-light)" stop-opacity="0.8" />
          <stop offset="0.5" stop-color="var(--account-cloud-light)" stop-opacity="0.24" />
          <stop offset="1" stop-color="var(--account-cloud-light)" stop-opacity="0" />
        </radialGradient>
        <linearGradient :id="rimId" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stop-color="var(--account-cloud-light)" stop-opacity="0.9" />
          <stop offset="0.55" stop-color="var(--account-cloud-rim)" stop-opacity="0.28" />
          <stop offset="1" stop-color="var(--account-cloud-rim)" stop-opacity="0.85" />
        </linearGradient>
      </defs>
      <ellipse cx="160" cy="215" rx="90" ry="4" class="sso-account-cloud__shadow" />
      <path
        :d="cloudOutline"
        :fill="`url(#${gradientId})`"
        :stroke="`url(#${rimId})`"
        class="sso-account-cloud__outline"
      />
      <path :d="cloudOutline" :fill="`url(#${lightId})`" class="sso-account-cloud__glaze" />
      <path
        d="M126 54C138 31 163 23 183 29"
        class="sso-account-cloud__highlight"
      />
      <path
        d="M39 179C46 190 56 195 70 195H256C273 195 285 188 294 176"
        :stroke="`url(#${rimId})`"
        class="sso-account-cloud__edge"
      />
    </svg>

    <span class="sso-account-cloud__content">
      <span class="sso-account-cloud__identity" aria-hidden="true">
        <MemberAvatar
          v-if="account.status === 'authenticated'"
          :src="account.avatar || '/app-icons/home-brand-mark.svg'"
          :alt="account.displayName"
          size="lg"
        />
        <Icon v-else-if="account.status === 'pending'" name="i-lucide-loader-circle" class="sso-account-cloud__loader" />
        <img v-else src="/app-icons/home-brand-mark.svg" alt="" width="48" height="48" class="sso-account-cloud__account-mark">
      </span>
      <strong>云乐坊账号</strong>
      <span class="sso-account-cloud__state">
        <template v-if="account.status === 'authenticated'">
          <Icon name="i-lucide-shield-check" aria-hidden="true" />
          {{ account.displayName }} · 已连接
        </template>
        <template v-else-if="account.status === 'pending'">正在确认账号</template>
        <template v-else>
          登录后连接应用 <Icon name="i-lucide-arrow-up-right" aria-hidden="true" />
        </template>
      </span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.sso-account-cloud {
  --account-cloud-top: var(--ui-bg-elevated);
  --account-cloud-middle: color-mix(in srgb, var(--ui-primary) 3%, var(--ui-bg-elevated));
  --account-cloud-bottom: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-elevated));
  --account-cloud-light: var(--ui-bg-elevated);
  --account-cloud-rim: color-mix(in srgb, var(--ui-primary) 20%, var(--ui-bg-elevated));

  position: relative;
  display: block;
  width: 18rem;
  height: 12.825rem;
  border-radius: 42%;
  color: var(--ui-text-highlighted);
}

:global(.dark .sso-account-cloud) {
  --account-cloud-top: color-mix(in srgb, var(--ui-primary) 16%, var(--ui-bg-accented));
  --account-cloud-middle: color-mix(in srgb, var(--ui-primary) 8%, var(--ui-bg-accented));
  --account-cloud-bottom: color-mix(in srgb, var(--ui-primary) 4%, var(--ui-bg-elevated));
  --account-cloud-light: color-mix(in srgb, var(--ui-primary) 35%, var(--ui-bg-accented));
  --account-cloud-rim: color-mix(in srgb, var(--ui-primary) 30%, var(--ui-bg-accented));
}

.sso-account-cloud__shape {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
  filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--ylf-shadow-color) 4%, transparent))
    drop-shadow(0 14px 18px color-mix(in srgb, var(--ui-primary) 11%, transparent));
}

.sso-account-cloud__outline {
  stroke-width: 1.1;
  vector-effect: non-scaling-stroke;
}

.sso-account-cloud__glaze {
  opacity: 0.65;
}

.sso-account-cloud__highlight {
  fill: none;
  stroke: var(--account-cloud-light);
  stroke-width: 1.8;
  stroke-linecap: round;
  opacity: 0.5;
}

.sso-account-cloud__edge {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  opacity: 0.75;
}

.sso-account-cloud__shadow {
  fill: color-mix(in srgb, var(--ui-primary) 10%, transparent);
  filter: blur(3px);
}

.sso-account-cloud__content {
  position: absolute;
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 0.35rem;
  inset: 4.35rem 2rem 1.25rem;
}

.sso-account-cloud__identity {
  display: grid;
  width: 2.8rem;
  height: 2.8rem;
  place-items: center;
  overflow: hidden;
  border-radius: 22%;
  color: var(--ui-primary);
}

.sso-account-cloud__identity > :deep(svg) {
  width: 1.3rem;
  height: 1.3rem;
}

.sso-account-cloud__account-mark {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sso-account-cloud strong {
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.sso-account-cloud__state {
  display: inline-flex;
  max-width: 13rem;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  color: var(--ui-primary);
  font-size: 0.68rem;
  line-height: 1.4;
  text-align: center;
  overflow-wrap: anywhere;
}

.sso-account-cloud__state :deep(svg) {
  width: 0.8rem;
  height: 0.8rem;
  flex: none;
}

.sso-account-cloud:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 4px;
}

.sso-account-cloud__loader {
  animation: sso-account-spin 1s linear infinite;
}

@keyframes sso-account-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 639px) {
  .sso-account-cloud {
    width: 15rem;
    height: 10.6875rem;
  }

  .sso-account-cloud__content {
    inset: 3.5rem 1.5rem 1rem;
    gap: 0.25rem;
  }

  .sso-account-cloud__identity {
    width: 2.3rem;
    height: 2.3rem;
  }

  .sso-account-cloud strong {
    font-size: 0.9rem;
  }
  .sso-account-cloud__state {
    font-size: 0.62rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-account-cloud__loader {
    animation: none;
  }
}
</style>
