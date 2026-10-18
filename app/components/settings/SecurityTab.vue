<script setup lang="ts">
import type { OAuthIdentityLike } from '~/utils/authProviders'
import { ShieldCheckIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
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
const configuredCredentialCount = computed(() =>
  Number(!!user.value?.email)
  + Number(!!user.value?.phone)
  + Number(!!user.value?.hasPassword),
)

// 凭证越多越安心：0–1 需加强，2 还不错，3 很安心
const securityLevel = computed(() => {
  const count = configuredCredentialCount.value
  if (count >= 3)
    return { key: 'great', label: '很安心' }
  if (count === 2)
    return { key: 'good', label: '还不错' }
  return { key: 'weak', label: '需加强' }
})

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
          <div
            class="security-meter shrink-0"
            :data-level="securityLevel.key"
            role="img"
            :aria-label="`已配置 ${configuredCredentialCount}/3 种登录凭证，${securityLevel.label}`"
          >
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle class="security-meter__track" cx="18" cy="18" r="15" pathLength="100" />
              <circle
                class="security-meter__value"
                cx="18"
                cy="18"
                r="15"
                pathLength="100"
                :style="{ '--p': configuredCredentialCount / 3 }"
              />
            </svg>
            <span class="security-meter__count" aria-hidden="true">{{ configuredCredentialCount }}/3</span>
            <span class="security-meter__label" aria-hidden="true">{{ securityLevel.label }}</span>
          </div>
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
    <Card v-if="isGitHubEnabled || isWeChatEnabled" class="p-4 sm:p-6">
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
    </Card>

    <!-- 登录设备（已授权桌面 / 本地应用） -->
    <SettingsSecurityDevices />

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
          <Button variant="outline" :disabled="authLoading" @click="showUnbindConfirm = false">
            取消
          </Button>
          <Button variant="destructive" :disabled="authLoading" @click="handleUnbind">
            <Spinner v-if="authLoading" />
            确认解绑
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.security-meter {
  --meter: var(--ylf-status-warning-text);

  position: relative;
  display: grid;
  width: 3.25rem;
  justify-items: center;
  gap: 0.125rem;
}

.security-meter[data-level='good'] {
  --meter: var(--primary);
}

.security-meter[data-level='great'] {
  --meter: var(--ylf-status-success-text);
}

.security-meter svg {
  width: 2.75rem;
  height: 2.75rem;
  rotate: -90deg;
}

.security-meter circle {
  fill: none;
  stroke-width: 3.5;
  stroke-linecap: round;
}

.security-meter__track {
  stroke: color-mix(in srgb, var(--meter) 14%, var(--muted));
}

/* 进度环从零画到当前凭证数，颜色随安全程度从暖黄过渡到晴空蓝、再到草地绿。 */
.security-meter__value {
  stroke: var(--meter);
  stroke-dasharray: 100;
  stroke-dashoffset: calc(100 - var(--p) * 100);
  transition:
    stroke-dashoffset var(--ylf-duration-slow) var(--ylf-ease-spring),
    stroke var(--ylf-duration-normal) var(--ylf-ease-standard);
  animation: security-meter-draw 1100ms var(--ylf-ease-spring) 200ms backwards;
}

@keyframes security-meter-draw {
  from {
    stroke-dashoffset: 100;
  }
}

.security-meter__count {
  position: absolute;
  top: 1.375rem;
  left: 50%;
  translate: -50% -50%;
  color: var(--foreground);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.security-meter__label {
  color: var(--meter);
  font-size: 0.6875rem;
  font-weight: 600;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .security-meter__value {
    animation: none;
  }
}

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
