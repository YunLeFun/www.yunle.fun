<script setup lang="ts">
import type { OAuthIdentityLike } from '~/utils/authProviders'
import { ShieldCheckIcon } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
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
const configuredCredentialCount = computed(() =>
  Number(!!user.value?.email)
  + Number(!!user.value?.phone)
  + Number(!!user.value?.hasPassword),
)

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
  <div class="space-y-6">
    <!-- 登录凭证 -->
    <Card class="security-credentials">
      <CardHeader class="security-credentials__header">
        <div class="flex min-w-0 items-start gap-3">
          <span class="security-credentials__mark" aria-hidden="true">
            <ShieldCheckIcon />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle>登录凭证</CardTitle>
            <CardDescription>
              管理可用于登录和找回账号的验证方式
            </CardDescription>
          </div>
          <Badge variant="outline" class="shrink-0">
            {{ configuredCredentialCount }}/3 已配置
          </Badge>
        </div>
      </CardHeader>

      <CardContent class="security-credentials__content">
        <!-- 邮箱 -->
        <SettingsSecurityBindEmail />
        <Separator />

        <!-- 手机号 -->
        <SettingsSecurityBindPhone />
        <Separator />

        <!-- 密码 -->
        <SettingsSecurityPassword />
      </CardContent>

      <CardFooter class="security-credentials__footer">
        <ShieldCheckIcon aria-hidden="true" />
        <p>建议保留两种可用凭证，换设备或忘记密码时仍能找回账号。</p>
      </CardFooter>
    </Card>

    <!-- 第三方账号 -->
    <UPageCard v-if="isGitHubEnabled || isWeChatEnabled" class="p-4 sm:p-6">
      <h3 class="mb-1 text-lg font-semibold">
        第三方账号
      </h3>
      <p class="mb-3 text-xs text-muted">
        绑定后可一键登录，无需输入密码
      </p>

      <div class="divide-y divide-default">
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
    </UPageCard>

    <!-- 登录设备（已授权桌面 / 本地应用） -->
    <SettingsSecurityDevices />

    <!-- 解绑确认弹窗 -->
    <UModal v-model:open="showUnbindConfirm">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-error-50 dark:bg-error-950">
              <UIcon name="i-lucide-unlink" class="text-xl text-error" />
            </div>
            <div>
              <h3 class="font-semibold">
                确认解绑
              </h3>
              <p class="text-sm text-muted">
                解绑后将无法使用 {{ unbindTarget?.label }} 账号登录，确定要继续吗？
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="showUnbindConfirm = false"
            />
            <UButton
              label="确认解绑"
              color="error"
              :loading="authLoading"
              @click="handleUnbind"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.security-credentials {
  position: relative;
  gap: 0;
  padding-block: 0;
  overflow: hidden;
  box-shadow: 0 22px 60px -48px color-mix(in srgb, var(--ylf-shadow-color) 34%, transparent);
}

.security-credentials::before {
  position: absolute;
  inset: 0 0 auto;
  height: 0.1875rem;
  content: '';
  background: var(--ylf-gradient-brand);
}

.security-credentials__header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--ylf-border-subtle);
  background:
    radial-gradient(circle at 3.25rem 1rem, color-mix(in srgb, var(--primary) 9%, transparent), transparent 8rem),
    var(--card);
}

.security-credentials__mark {
  display: flex;
  width: 2.5rem;
  height: 2.5rem;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 11%, var(--card));
  border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border));
  border-radius: var(--radius-lg);
}

.security-credentials__mark svg {
  width: 1.125rem;
  height: 1.125rem;
}

.security-credentials__content {
  padding-inline: 0;
}

.security-credentials__content :deep([data-slot='separator']) {
  margin-left: 5rem;
  width: calc(100% - 5rem);
}

.security-credentials__footer {
  gap: 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  line-height: 1.25rem;
}

.security-credentials__footer svg {
  width: 0.875rem;
  height: 0.875rem;
  flex: none;
}
</style>
