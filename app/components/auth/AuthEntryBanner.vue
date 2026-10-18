<script setup lang="ts">
import type { AuthRouteState } from './AuthRoute.vue'
import AppProductIcon from '~/components/apps/AppProductIcon.vue'

/**
 * 登录 / 注册卡片顶部的来路说明。
 *
 * - SSO：云乐坊 → 应用 的航线，带域名与核验状态；原生 App 额外说明会自动跳回。
 * - 设备授权：云乐坊 → 桌面应用；设备码整行完整显示，供用户与桌面端逐位核对。
 * - 站内页面：一枚「登录后继续前往 …」的小胶囊。
 */
const { routeState = 'idle' } = defineProps<{
  /** 由页面按登录进度传入，驱动航线上小云的动作 */
  routeState?: AuthRouteState
}>()

const { entry, ssoClient, ssoHost, ssoVerified, destinationName } = useAuthEntry()

const deviceCode = computed(() => entry.value.kind === 'device' ? entry.value.userCode : null)
const isNative = computed(() => entry.value.kind === 'sso' && entry.value.native)
</script>

<template>
  <div v-if="entry.kind === 'sso' || entry.kind === 'device'" class="auth-entry" :style="{ '--auth-entry-accent': ssoClient?.accent ?? 'var(--ylf-sso-accent)' }">
    <AuthRoute
      from-label="云乐坊账号"
      :to-label="destinationName ?? ''"
      :to-hint="entry.kind === 'sso' ? ssoHost : ''"
      :to-hint-tone="entry.kind === 'sso' && !ssoVerified ? 'warning' : 'safe'"
      :accent="ssoClient?.accent"
      :state="routeState"
    >
      <template #from>
        <span class="auth-entry__brand ylf-gradient-tile">
          <YlfLogo class="h-5 w-7 text-primary-foreground" aria-hidden="true" />
        </span>
      </template>
      <template #to>
        <AppProductIcon
          v-if="ssoClient?.logoUrl"
          :app="{ appId: ssoClient.appId, logoUrl: ssoClient.logoUrl, fallbackMark: ssoClient.fallbackMark }"
        />
        <span v-else-if="ssoClient" class="auth-entry__mark">{{ ssoClient.fallbackMark }}</span>
        <span v-else class="auth-entry__mark">
          <Icon :name="entry.kind === 'device' ? 'i-lucide-monitor-smartphone' : 'i-lucide-globe'" class="size-6" />
        </span>
      </template>
    </AuthRoute>

    <p v-if="entry.kind === 'sso' && !ssoVerified" class="auth-entry__note auth-entry__note--warning" role="note">
      未能核验这个来源。请确认链接来自你信任的云乐坊应用，登录后云乐坊仍会再次校验。
    </p>
    <p v-else-if="isNative" class="auth-entry__note">
      <Icon name="i-lucide-smartphone" class="size-3.5 shrink-0" />
      登录完成后会自动回到 {{ destinationName }} App
    </p>
    <div v-else-if="entry.kind === 'device' && deviceCode" class="auth-entry__note auth-entry__note--code">
      <span class="inline-flex items-center gap-1.5">
        <Icon name="i-lucide-shield-check" class="size-3.5 shrink-0" />
        请确认与桌面应用上显示的设备码一致
      </span>
      <code class="auth-entry__code" :aria-label="`设备码 ${deviceCode.split('').join(' ')}`">{{ deviceCode }}</code>
    </div>
    <p v-else-if="entry.kind === 'device'" class="auth-entry__note">
      <Icon name="i-lucide-shield-check" class="size-3.5 shrink-0" />
      登录后核对设备码，确认无误再授权
    </p>
  </div>

  <div v-else-if="entry.kind === 'page'" class="auth-entry-pill">
    <Icon name="i-lucide-corner-down-right" class="size-3.5 shrink-0" />
    <span v-if="destinationName">登录后继续前往<strong>{{ destinationName }}</strong></span>
    <span v-else>登录后回到刚才的页面</span>
  </div>
</template>

<style scoped>
.auth-entry {
  --_accent: var(--auth-entry-accent);

  position: relative;
  padding: 0.875rem 0.75rem 0.75rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--_accent) 18%, var(--ui-border-muted));
  border-radius: 1.25rem;
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--_accent) 14%, transparent), transparent 62%),
    linear-gradient(160deg, color-mix(in srgb, var(--ylf-sso-sky) 12%, var(--ylf-surface)), var(--ylf-surface));
  box-shadow: 0 1px 0 color-mix(in srgb, var(--ylf-glass-highlight) 70%, transparent) inset;
}

.auth-entry__brand,
.auth-entry__mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 22%;
}

.auth-entry__brand {
  box-shadow: 0 10px 20px -14px color-mix(in srgb, var(--ui-primary) 80%, transparent);
}

.auth-entry__mark {
  background: color-mix(in srgb, var(--_accent) 14%, var(--ylf-surface));
  color: var(--_accent);
  font-size: 1.125rem;
  font-weight: 700;
}

.auth-entry__note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  margin-top: 0.625rem;
  padding-top: 0.625rem;
  border-top: 1px dashed color-mix(in srgb, var(--_accent) 22%, var(--ui-border-muted));
  color: var(--ui-text-muted);
  font-size: var(--ylf-type-caption);
  line-height: 1.5;
  text-align: center;
  text-wrap: balance;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.auth-entry__note--code {
  flex-direction: column;
  gap: 0.5rem;
}

/* 设备码：等宽、加字距、不换行不截断，方便和桌面端逐位比对 */
.auth-entry__code {
  padding: 0.25rem 0.75rem;
  border: 1px dashed color-mix(in srgb, var(--_accent) 40%, var(--ui-border));
  border-radius: 0.625rem;
  background: var(--ylf-surface);
  color: var(--ui-text-highlighted);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  white-space: nowrap;
}

.auth-entry__note--warning {
  color: var(--ylf-status-warning-text, #b45309);
}

.auth-entry-pill {
  display: flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 0.375rem;
  margin-inline: auto;
  padding: 0.3125rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, var(--ui-border-muted));
  border-radius: 9999px;
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ylf-surface));
  color: var(--ui-text-muted);
  font-size: var(--ylf-type-caption);
}

.auth-entry-pill strong {
  margin-left: 0.25rem;
  color: var(--ui-text-highlighted);
  font-weight: 600;
}
</style>
