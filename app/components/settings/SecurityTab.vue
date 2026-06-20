<script setup lang="ts">
import {
  getBoundOAuthProviderIds,
  GITHUB_PROVIDER_ID,
  hasOAuthProvider,
  isOAuthProviderEnabled,
  normalizeOAuthProviderId,
  WECHAT_PROVIDER_ID,
} from '~/utils/authProviders'
import { maskPhone } from '~/utils/mask'

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
const userProviders = computed(() =>
  (user.value?.providers || []).map(normalizeOAuthProviderId).filter(Boolean),
)
const allBoundProviders = computed(() => [...userProviders.value, ...boundProviders.value])

const isGitHubBound = computed(() =>
  hasOAuthProvider(allBoundProviders.value, GITHUB_PROVIDER_ID),
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
    <UPageCard class="p-6">
      <h3 class="mb-1 text-lg font-semibold">
        登录凭证
      </h3>
      <p class="mb-3 text-xs text-muted">
        用于登录账户的方式，建议至少绑定一种并设置密码
      </p>

      <div class="divide-y divide-default">
        <!-- 邮箱 -->
        <SettingsSecurityBindEmail />

        <!-- 手机号 -->
        <div class="flex items-center justify-between gap-3 py-4">
          <div class="min-w-0 flex-1 space-y-1">
            <p class="text-sm font-medium">
              手机号
            </p>
            <p class="truncate text-xs text-muted">
              {{ user?.phone ? `已绑定 ${maskPhone(user.phone)}` : '未绑定手机号' }}
            </p>
          </div>
          <UBadge
            class="shrink-0"
            :label="user?.phone ? '已绑定' : '未绑定'"
            :color="user?.phone ? 'success' : 'warning'"
            variant="subtle"
            size="sm"
          />
        </div>

        <!-- 密码 -->
        <SettingsSecurityPassword />
      </div>
    </UPageCard>

    <!-- 第三方账号 -->
    <UPageCard v-if="isGitHubEnabled || isWeChatEnabled" class="p-6">
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
          icon="i-simple-icons-github"
          :bound="isGitHubBound"
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
          icon="i-simple-icons-wechat"
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
