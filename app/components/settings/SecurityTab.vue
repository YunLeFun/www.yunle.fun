<script setup lang="ts">
import type { OAuthIdentityLike } from '~/utils/authProviders'
import { CheckIcon, CircleDashedIcon, ShieldCheckIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import {
  getBoundOAuthProviderIds,
  getOAuthIdentityName,
  GITHUB_PROVIDER_ID,
  hasOAuthProvider,
  isOAuthProviderEnabled,
  normalizeOAuthProviderId,
  WECHAT_PROVIDER_ID,
} from '~/utils/authProviders'

const {
  user,
  bindGitHub,
  bindWeChat,
  unbindIdentity,
  getUserIdentities,
  loading: authLoading,
} = useTcbAuth()

// 通过 getUserIdentities API 获取的真实绑定状态
const boundProviders = ref<string[]>([])
const boundIdentities = ref<OAuthIdentityLike[]>([])
const userProviders = computed(() =>
  (user.value?.providers || []).map(normalizeOAuthProviderId).filter(Boolean),
)
const allBoundProviders = computed(() => [...userProviders.value, ...boundProviders.value])
const credentials = computed(() => [
  { key: 'email', ready: !!user.value?.email, label: user.value?.email ? '邮箱已绑定' : '邮箱未绑定' },
  { key: 'phone', ready: !!user.value?.phone, label: user.value?.phone ? '手机已绑定' : '手机未绑定' },
  { key: 'password', ready: !!user.value?.hasPassword, label: user.value?.hasPassword == null ? '密码状态待确认' : user.value.hasPassword ? '密码已设置' : '密码未设置' },
])

const isGitHubBound = computed(() =>
  hasOAuthProvider(allBoundProviders.value, GITHUB_PROVIDER_ID),
)
const githubLogin = computed(() =>
  getOAuthIdentityName(boundIdentities.value, GITHUB_PROVIDER_ID),
)
const isWeChatBound = computed(() =>
  hasOAuthProvider(allBoundProviders.value, WECHAT_PROVIDER_ID),
)

// 仅展示当前线上实际可用的第三方登录绑定入口（与登录页共用同一白名单）
const isGitHubEnabled = computed(() => isOAuthProviderEnabled(GITHUB_PROVIDER_ID))
const isWeChatEnabled = computed(() => isOAuthProviderEnabled(WECHAT_PROVIDER_ID))

// 第三方绑定状态查询 loading
const providersLoading = ref(true)

// 独立的操作 loading 状态
const githubLoading = ref(false)
const wechatLoading = ref(false)
const unbindLoading = ref(false)

// 解绑确认弹窗
const showUnbindConfirm = ref(false)
const unbindTarget = ref<{ provider: string, label: string } | null>(null)

// 刷新第三方绑定状态
async function refreshBoundProviders() {
  try {
    const identities = await getUserIdentities()
    boundIdentities.value = identities
    boundProviders.value = getBoundOAuthProviderIds(identities)
  }
  catch {
    // 忽略错误
  }
  finally {
    providersLoading.value = false
  }
}

// 绑定 GitHub
async function handleBindGitHub() {
  try {
    githubLoading.value = true
    await bindGitHub()
    await refreshBoundProviders()
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    githubLoading.value = false
  }
}

// 绑定微信
async function handleBindWeChat() {
  try {
    wechatLoading.value = true
    await bindWeChat()
    await refreshBoundProviders()
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    wechatLoading.value = false
  }
}

// 解绑确认
function confirmUnbind(provider: string, label: string) {
  unbindTarget.value = { provider, label }
  showUnbindConfirm.value = true
}

async function handleUnbind() {
  if (!unbindTarget.value)
    return
  try {
    unbindLoading.value = true
    await unbindIdentity(unbindTarget.value.provider)
    await refreshBoundProviders()
    showUnbindConfirm.value = false
    unbindTarget.value = null
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    unbindLoading.value = false
  }
}

// 页面挂载时刷新第三方绑定状态
onMounted(async () => {
  await refreshBoundProviders()
})
</script>

<template>
  <div class="security-settings">
    <SettingsPageHeader title="安全设置" description="为你的云端生活，多一份安心。" security>
      <ul class="security-summary" aria-label="登录凭证状态" aria-live="polite">
        <li v-for="credential in credentials" :key="credential.key" class="security-summary__item" :class="{ 'security-summary__item--ready': credential.ready }">
          <CheckIcon v-if="credential.ready" aria-hidden="true" />
          <CircleDashedIcon v-else aria-hidden="true" />
          {{ credential.label }}
        </li>
      </ul>
    </SettingsPageHeader>
    <div class="security-body">
      <section class="security-credentials" aria-labelledby="credentials-title">
        <header class="security-section-heading">
          <h2 id="credentials-title">
            登录凭证
          </h2>
          <p>管理登录和找回账号的验证方式</p>
        </header>
        <div class="security-credentials__list">
          <SettingsSecurityBindEmail />
          <SettingsSecurityBindPhone />
          <SettingsSecurityPassword />
        </div>
        <p class="security-tip">
          <ShieldCheckIcon aria-hidden="true" />
          建议保留两种可用凭证，换设备或忘记密码时仍能找回账号。
        </p>
      </section>
      <section v-if="isGitHubEnabled || isWeChatEnabled" class="security-providers" aria-labelledby="providers-title">
        <header class="security-section-heading">
          <h2 id="providers-title">
            第三方账号
          </h2>
          <p>绑定后可一键登录，无需输入密码</p>
        </header>
        <div class="divide-y divide-default border-t border-default">
          <!-- GitHub -->
          <SettingsSecurityOAuthProvider
            v-if="isGitHubEnabled"
            provider="github"
            label="GitHub"
            icon="i-ri-github-fill"
            :bound="isGitHubBound"
            :account-login="githubLogin"
            :loading="githubLoading || (unbindLoading && unbindTarget?.provider === 'github')"
            :providers-loading="providersLoading"
            @bind="handleBindGitHub"
            @unbind="confirmUnbind('github', 'GitHub')"
          />

          <!-- 微信 -->
          <SettingsSecurityOAuthProvider
            v-if="isWeChatEnabled"
            provider="wx_open"
            label="微信"
            icon="i-ri-wechat-fill"
            icon-class="text-green-500"
            :bound="isWeChatBound"
            :loading="wechatLoading || (unbindLoading && unbindTarget?.provider === 'wx_open')"
            :providers-loading="providersLoading"
            @bind="handleBindWeChat"
            @unbind="confirmUnbind('wx_open', '微信')"
          />
        </div>
      </section>
      <SettingsSecurityDevices class="security-devices" />
    </div>
    <!-- 解绑确认弹窗 -->
    <Dialog v-model:open="showUnbindConfirm">
      <DialogContent>
        <DialogHeader>
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-error-50 dark:bg-error-950">
              <Icon name="i-lucide-unlink" class="size-5 text-error" />
            </div>
            <div>
              <DialogTitle>
                确认解绑
              </DialogTitle>
              <DialogDescription>
                解绑后将无法使用 {{ unbindTarget?.label }} 账号登录，确定要继续吗？
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="authLoading || unbindLoading" @click="showUnbindConfirm = false">
            取消
          </Button>
          <Button variant="destructive" :disabled="authLoading || unbindLoading" @click="handleUnbind">
            <Spinner v-if="authLoading || unbindLoading" />
            确认解绑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.security-settings {
  min-width: 0;
}
.security-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.125rem;
  margin-top: 1.25rem;
  padding: 0;
  list-style: none;
}
.security-summary__item {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  font-size: 0.75rem;
  line-height: 1.75;
  color: var(--ylf-c-text-2);
}
.security-summary__item--ready {
  color: var(--ylf-status-success-text);
}
.security-summary__item svg {
  width: 0.9375rem;
  height: 0.9375rem;
  flex: none;
}
.security-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem;
  gap: 2rem;
  margin-top: 1.875rem;
  align-items: start;
}
.security-section-heading {
  margin-bottom: 0.9375rem;
}
.security-section-heading h2 {
  font-family: var(--ylf-font-heading);
  font-size: 1.125rem;
  font-weight: 650;
  line-height: 1.5;
}
.security-section-heading p {
  margin-top: 0.3125rem;
  font-size: 0.8125rem;
  line-height: 1.7;
  color: var(--ylf-c-text-3);
}
.security-credentials__list {
  border-top: 1px solid var(--ylf-c-border);
}
.security-tip {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 1rem;
  font-size: 0.75rem;
  line-height: 1.8;
  color: var(--ylf-c-text-3);
}
.security-tip svg {
  flex: none;
  width: 1rem;
  height: 1rem;
  margin-top: 0.1875rem;
}
.security-providers {
  grid-column: 1;
}
.security-devices {
  grid-column: 2;
  grid-row: 1 / span 2;
}
@media (max-width: 1100px) {
  .security-body {
    grid-template-columns: minmax(0, 1fr);
  }
  .security-devices {
    grid-column: auto;
    grid-row: auto;
  }
}
@media (max-width: 640px) {
  .security-summary {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.375rem;
    margin-top: 1rem;
  }
  .security-body {
    margin-top: 1.5rem;
    gap: 1.75rem;
  }
}
</style>
