<script setup lang="ts">
const { user, logout } = useTcbAuth()
const { isActive: isMember, state: membershipState, refresh: refreshMembership } = useMembership()
const { app } = useCloudbase()
const toast = useToast()

const showLogoutConfirm = ref(false)

// 账号注销（软注销）：强确认，需输入关键词「注销」
const showDeleteConfirm = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)
const DELETE_KEYWORD = '注销'
const canDelete = computed(() => deleteConfirmText.value.trim() === DELETE_KEYWORD)

function openDeleteConfirm() {
  deleteConfirmText.value = ''
  showDeleteConfirm.value = true
}

async function handleDeleteAccount() {
  if (!canDelete.value || !app)
    return
  deleting.value = true
  try {
    await app.callFunction({ name: 'account-api', data: { action: 'requestAccountDeletion' } })
    showDeleteConfirm.value = false
    toast.add({ title: '账号已注销', description: '资料已清除，即将退出登录', icon: 'i-lucide-check', color: 'success' })
    await logout()
    await navigateTo('/')
  }
  catch (err) {
    toast.add({ title: '注销失败', description: err instanceof Error ? err.message : '请稍后重试', color: 'error' })
  }
  finally {
    deleting.value = false
  }
}
const isAdmin = computed(() => user.value?.role === 'ADMIN')

const joinDate = computed(() =>
  user.value?.createdAt ? new Date(user.value.createdAt).toLocaleDateString('zh-CN') : '未知',
)

/** 会员剩余天数；非会员返回 null */
const memberDaysLeft = computed(() => {
  const ms = membershipState.value?.remainingMs
  if (!isMember.value || ms == null)
    return null
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
})
/** 会员即将到期（7 天内） */
const memberExpiringSoon = computed(() => memberDaysLeft.value != null && memberDaysLeft.value <= 7)

onMounted(() => {
  // useMembership 的 watch 为 immediate:false，挂载时手动拉一次
  refreshMembership()
})

async function copyUid() {
  if (!user.value?.id)
    return
  try {
    await navigator.clipboard.writeText(user.value.id)
    toast.add({ title: '已复制用户 ID', icon: 'i-lucide-check', color: 'success' })
  }
  catch {
    toast.add({ title: '复制失败', color: 'error' })
  }
}

async function handleLogout() {
  showLogoutConfirm.value = false
  await logout()
}
</script>

<template>
  <div class="space-y-6">
    <UPageCard class="p-6">
      <h3 class="mb-4 text-lg font-semibold">
        账户信息
      </h3>

      <div class="divide-y divide-default">
        <!-- 会员状态：取代易与「会员」混淆的「账户角色：普通用户」 -->
        <div class="flex items-center justify-between gap-3 py-3">
          <span class="shrink-0 text-sm text-muted">会员状态</span>
          <div v-if="isMember" class="flex flex-wrap items-center justify-end gap-2">
            <MemberBadge
              size="sm"
              variant="fill"
              :expire-at="membershipState?.expireAt ?? null"
            />
            <UButton
              v-if="memberExpiringSoon"
              to="/pricing"
              :label="`${memberDaysLeft} 天后到期 · 续费`"
              icon="i-lucide-clock-alert"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
          <div v-else class="flex items-center gap-2">
            <span class="text-sm text-muted">未开通</span>
            <UButton
              to="/pricing"
              label="去开通"
              icon="i-lucide-sparkles"
              color="primary"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>

        <!-- 管理权限：仅管理员可见，普通用户不显示（避免「普通用户」歧义） -->
        <div v-if="isAdmin" class="flex items-center justify-between gap-3 py-3">
          <span class="shrink-0 text-sm text-muted">管理权限</span>
          <UBadge label="管理员" color="error" variant="subtle" size="sm" icon="i-lucide-shield-check" />
        </div>

        <!-- 用户 ID：移动端可截断，支持一键复制 -->
        <div class="flex items-center justify-between gap-3 py-3">
          <span class="shrink-0 text-sm text-muted">用户 ID</span>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate font-mono text-sm text-muted">{{ user?.id }}</span>
            <UButton
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="复制用户 ID"
              class="shrink-0"
              @click="copyUid"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 py-3">
          <span class="shrink-0 text-sm text-muted">注册时间</span>
          <span class="text-sm">{{ joinDate }}</span>
        </div>
      </div>
    </UPageCard>

    <!-- 退出 & 危险操作 -->
    <UPageCard class="p-6">
      <h3 class="mb-4 text-lg font-semibold text-error">
        危险操作
      </h3>

      <div class="divide-y divide-default">
        <div class="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              退出登录
            </p>
            <p class="text-xs text-muted">
              退出当前设备的登录状态
            </p>
          </div>
          <UButton
            label="退出登录"
            color="error"
            variant="outline"
            size="sm"
            icon="i-lucide-log-out"
            class="self-start sm:self-auto"
            @click="showLogoutConfirm = true"
          />
        </div>

        <div class="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              注销账号
            </p>
            <p class="text-xs text-muted">
              清除你的资料、关注与通知并退出；订单等记录依法保留
            </p>
          </div>
          <UButton
            label="注销账号"
            color="error"
            variant="soft"
            size="sm"
            icon="i-lucide-user-x"
            class="self-start sm:self-auto"
            @click="openDeleteConfirm"
          />
        </div>
      </div>
    </UPageCard>

    <!-- 退出确认弹窗 -->
    <UModal v-model:open="showLogoutConfirm">
      <template #content>
        <div class="space-y-4 p-6">
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-error-50 p-2 dark:bg-error-950">
              <UIcon name="i-lucide-log-out" class="text-xl text-error" />
            </div>
            <div>
              <h3 class="font-semibold">
                确认退出
              </h3>
              <p class="text-sm text-muted">
                您确定要退出当前账户吗？
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="showLogoutConfirm = false"
            />
            <UButton
              label="确认退出"
              color="error"
              @click="handleLogout"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- 注销账号确认弹窗（强确认：输入「注销」二字） -->
    <UModal v-model:open="showDeleteConfirm">
      <template #content>
        <div class="space-y-4 p-6">
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-error-50 p-2 dark:bg-error-950">
              <UIcon name="i-lucide-user-x" class="text-xl text-error" />
            </div>
            <div class="min-w-0">
              <h3 class="font-semibold">
                确认注销账号
              </h3>
              <p class="text-sm text-muted">
                此操作不可撤销
              </p>
            </div>
          </div>

          <div class="space-y-2 rounded-lg bg-elevated/60 p-3 text-xs text-muted">
            <p>注销后将立即：</p>
            <ul class="list-disc space-y-0.5 pl-4">
              <li>清除昵称、头像、简介，释放用户名</li>
              <li>解除你的全部关注与粉丝关系</li>
              <li>删除你收到的站内通知并退出登录</li>
            </ul>
            <p>为满足对账与合规，<strong>订单与交易记录将依法保留</strong>。</p>
          </div>

          <UFormField label="请输入「注销」以确认">
            <UInput
              v-model="deleteConfirmText"
              placeholder="注销"
              autocomplete="off"
              :disabled="deleting"
            />
          </UFormField>

          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              :disabled="deleting"
              @click="showDeleteConfirm = false"
            />
            <UButton
              label="确认注销"
              color="error"
              :loading="deleting"
              :disabled="!canDelete"
              @click="handleDeleteAccount"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
