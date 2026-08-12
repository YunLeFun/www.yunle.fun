<script setup lang="ts">
import type { SsoAccountState } from '~/types/app-explorer'
import { useId } from 'vue'

defineProps<{
  account: SsoAccountState
}>()

const gradientId = `sso-account-cloud-${useId()}`
</script>

<template>
  <NuxtLink
    :to="account.to"
    class="sso-account-cloud"
    data-testid="sso-account-cloud"
  >
    <svg
      class="sso-account-cloud__shape"
      viewBox="0 0 360 210"
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="var(--ylf-sso-cloud-top)" />
          <stop offset="0.62" stop-color="var(--ylf-sso-cloud-middle)" />
          <stop offset="1" stop-color="var(--ylf-sso-cloud-base)" />
        </linearGradient>
      </defs>
      <path
        d="M55 188C25 188 8 171 10 147C12 124 30 108 53 105C58 77 82 56 111 54C126 22 159 5 193 13C219 19 238 40 244 66C277 66 303 88 307 117C335 121 353 140 351 162C349 180 333 189 309 189H55Z"
        :fill="`url(#${gradientId})`"
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
        <Icon
          v-else-if="account.status === 'pending'"
          name="i-lucide-loader-circle"
          class="sso-account-cloud__loader"
        />
        <img
          v-else
          src="/app-icons/home-brand-mark.svg"
          alt=""
          width="64"
          height="64"
          class="sso-account-cloud__account-mark"
        >
      </span>

      <strong>云乐坊账号</strong>
      <span class="sso-account-cloud__state">
        <Icon
          :name="account.status === 'authenticated' ? 'i-lucide-shield-check' : 'i-lucide-log-in'"
          aria-hidden="true"
        />
        <template v-if="account.status === 'authenticated'">
          {{ account.displayName }} · 已连接
        </template>
        <template v-else-if="account.status === 'pending'">
          正在确认账号
        </template>
        <template v-else>
          登录后连接应用
        </template>
      </span>
    </span>
  </NuxtLink>
</template>

<style scoped>
.sso-account-cloud {
  position: relative;
  display: block;
  width: 21.5rem;
  height: 12.55rem;
  border-radius: 48% 48% 24% 24%;
  color: var(--ylf-sso-ink);
  outline: none;
  transition: transform 180ms ease;
  will-change: transform;
}

.sso-account-cloud__shape {
  position: absolute;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 22px 28px color-mix(in srgb, var(--ylf-sso-cloud-shadow) 24%, transparent))
    drop-shadow(0 0 18px color-mix(in srgb, var(--ylf-sso-cloud-top) 34%, transparent));
  inset: 0;
}

.sso-account-cloud__content {
  position: absolute;
  display: grid;
  justify-items: center;
  gap: 0.38rem;
  inset: 4.35rem 3rem 1rem;
}

.sso-account-cloud__identity {
  display: grid;
  width: 3.05rem;
  height: 3.05rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-border) 48%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ylf-sso-cloud-top) 78%, transparent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--ylf-sso-cloud-shadow-strong) 18%, transparent);
  color: var(--ylf-sso-accent);
}

.sso-account-cloud__identity > :deep(svg) {
  width: 1.3rem;
  height: 1.3rem;
}

.sso-account-cloud__account-mark {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.sso-account-cloud__loader {
  animation: sso-account-spin 1s linear infinite;
}

.sso-account-cloud strong {
  font-size: 1.08rem;
  font-weight: 850;
  letter-spacing: -0.025em;
}

.sso-account-cloud__state {
  display: inline-flex;
  max-width: 13.5rem;
  gap: 0.3rem;
  align-items: center;
  justify-content: center;
  color: var(--ylf-sso-accent);
  font-size: 0.7rem;
  font-weight: 750;
}

.sso-account-cloud__state :deep(svg) {
  width: 0.82rem;
  height: 0.82rem;
  flex: none;
}

.sso-account-cloud:hover,
.sso-account-cloud:focus-visible {
  transform: translateY(-0.3rem);
}

.sso-account-cloud:focus-visible {
  outline: 3px solid var(--ylf-sso-cloud-top);
  outline-offset: 4px;
}

@keyframes sso-account-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 767px) {
  .sso-account-cloud {
    width: 18.5rem;
    height: 10.8rem;
  }

  .sso-account-cloud__content {
    gap: 0.3rem;
    inset: 3.25rem 2.5rem 1.25rem;
  }

  .sso-account-cloud__identity {
    width: 2.65rem;
    height: 2.65rem;
  }

  .sso-account-cloud strong {
    font-size: 0.95rem;
  }

  .sso-account-cloud__state {
    font-size: 0.66rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-account-cloud {
    transition: none;
  }

  .sso-account-cloud:hover,
  .sso-account-cloud:focus-visible {
    transform: none;
  }

  .sso-account-cloud__loader {
    animation: none;
  }
}
</style>
