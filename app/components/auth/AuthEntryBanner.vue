<script setup lang="ts">
import AppProductIcon from '~/components/apps/AppProductIcon.vue'

// 保留真实域名、未核验来源提示与完整设备码，便于用户在登录前核对去向。
const { entry, ssoClient, ssoHost, ssoVerified, destinationName } = useAuthEntry()
const deviceCode = computed(() => entry.value.kind === 'device' ? entry.value.userCode : null)
const isNative = computed(() => entry.value.kind === 'sso' && entry.value.native)
</script>

<template>
  <div v-if="entry.kind === 'sso' || entry.kind === 'device'" class="auth-entry space-y-2">
    <div class="flex min-w-0 items-center gap-2.5">
      <span class="auth-entry__icon shrink-0" aria-hidden="true">
        <AppProductIcon
          v-if="ssoClient?.logoUrl"
          :app="{ appId: ssoClient.appId, logoUrl: ssoClient.logoUrl, fallbackMark: ssoClient.fallbackMark }"
        />
        <Icon v-else :name="entry.kind === 'device' ? 'i-lucide-monitor-smartphone' : 'i-lucide-globe'" class="size-5 text-muted" />
      </span>
      <p class="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]" :class="entry.kind === 'sso' && !ssoVerified ? 'text-warning' : 'text-muted'">
        {{ entry.kind === 'sso' ? ssoHost : '登录后核对设备码并授权' }}
      </p>
    </div>
    <p v-if="entry.kind === 'sso' && !ssoVerified" class="text-xs leading-5 text-warning" role="note">
      未能核验来源，请确认你信任此应用。
    </p>
    <p v-else-if="isNative" class="text-xs leading-5 text-muted">
      完成后返回 {{ destinationName }} App
    </p>
    <div v-else-if="deviceCode" class="space-y-1">
      <p class="text-xs leading-5 text-muted">
        请核对桌面应用上的设备码
      </p>
      <code class="auth-entry__code" :aria-label="`设备码 ${deviceCode.split('').join(' ')}`">{{ deviceCode }}</code>
    </div>
  </div>
  <p v-else-if="entry.kind === 'page'" class="text-sm leading-6 text-muted">
    {{ destinationName ? `登录后前往${destinationName}` : '登录后回到刚才的页面' }}
  </p>
</template>

<style scoped>
.auth-entry__icon {
  --app-icon-size: 2rem;

  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
}

.auth-entry__code {
  display: inline-block;
  color: var(--ylf-c-text);
  font-family: var(--ylf-font-mono);
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  white-space: nowrap;
}
</style>
