<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

interface AccountDeletionStatus {
  status: 'none' | 'pending' | 'finalizing' | 'completed' | 'attention_required'
  requestedAt: number | null
  scheduledAt: number | null
  remainingMs: number
  canCancel: boolean
}

const EMPTY_DELETION_STATUS: AccountDeletionStatus = {
  status: 'none',
  requestedAt: null,
  scheduledAt: null,
  remainingMs: 0,
  canCancel: false,
}

const { user, logout } = useTcbAuth()
const { isActive: isMember, state: membershipState, refresh: refreshMembership } = useMembership()
const { app } = useCloudbase()
const { refresh: refreshAccountAccess } = useAccountAccess()
const toast = useAppToast()

const showLogoutConfirm = ref(false)
const showDeleteConfirm = ref(false)
const deleteConfirmText = ref('')
const deleting = ref(false)
const deletionStatusLoading = ref(true)
const deletionState = ref<AccountDeletionStatus>({ ...EMPTY_DELETION_STATUS })
const clock = ref(Date.now())
const DELETE_KEYWORD = '注销'
const canDelete = computed(() => deleteConfirmText.value.trim() === DELETE_KEYWORD)
let clockTimer: ReturnType<typeof setInterval> | undefined

async function callDeletionApi(action: 'requestAccountDeletion' | 'getAccountDeletionStatus' | 'cancelAccountDeletion') {
  if (!app)
    throw new Error('账号服务暂不可用')
  const response = await app.callFunction({ name: 'account-api', data: { action } })
  return response.result as AccountDeletionStatus
}

async function refreshDeletionStatus() {
  if (!app) {
    deletionStatusLoading.value = false
    return
  }
  try {
    deletionState.value = await callDeletionApi('getAccountDeletionStatus')
  }
  catch (error) {
    toast.add({
      title: '注销状态读取失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    deletionStatusLoading.value = false
  }
}

function openDeleteConfirm() {
  deleteConfirmText.value = ''
  showDeleteConfirm.value = true
}

async function handleDeleteAccount() {
  if (!canDelete.value || !app)
    return
  deleting.value = true
  try {
    deletionState.value = await callDeletionApi('requestAccountDeletion')
    showDeleteConfirm.value = false
    toast.add({
      title: '注销申请已提交',
      description: '已进入 30 天冷静期，账号功能现已冻结；请在截止时间前前往账号状态页恢复',
      icon: 'i-lucide-clock-3',
      color: 'warning',
    })
    await refreshAccountAccess(user.value?.id, true)
    await navigateTo('/account-status')
  }
  catch (error) {
    toast.add({ title: '申请失败', description: error instanceof Error ? error.message : '请稍后重试', color: 'error' })
  }
  finally {
    deleting.value = false
  }
}

const isAdmin = computed(() => user.value?.role === 'ADMIN')
const joinDate = computed(() =>
  user.value?.createdAt ? new Date(user.value.createdAt).toLocaleDateString('zh-CN') : '未知',
)

const memberDaysLeft = computed(() => {
  const ms = membershipState.value?.remainingMs
  if (!isMember.value || ms == null)
    return null
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
})
const memberExpiringSoon = computed(() => memberDaysLeft.value != null && memberDaysLeft.value <= 7)
const memberExpiryDate = computed(() => {
  const expireAt = membershipState.value?.expireAt
  return expireAt
    ? new Date(expireAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : ''
})

const liveRemainingMs = computed(() => {
  if (deletionState.value.status !== 'pending' || !deletionState.value.scheduledAt)
    return 0
  return Math.max(0, deletionState.value.scheduledAt - clock.value)
})
const deletionDaysLeft = computed(() => Math.ceil(liveRemainingMs.value / (24 * 60 * 60 * 1000)))
const deletionProgress = computed(() => {
  const total = 30 * 24 * 60 * 60 * 1000
  return Math.min(100, Math.max(0, ((total - liveRemainingMs.value) / total) * 100))
})
const deletionRemainingLabel = computed(() => {
  if (!liveRemainingMs.value)
    return '等待到期清理'
  if (deletionDaysLeft.value >= 1)
    return `还剩 ${deletionDaysLeft.value} 天`
  return `还剩 ${Math.max(1, Math.ceil(liveRemainingMs.value / (60 * 60 * 1000)))} 小时`
})
const scheduledDeletionDate = computed(() => {
  if (!deletionState.value.scheduledAt)
    return '待定'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(deletionState.value.scheduledAt))
})

onMounted(() => {
  refreshMembership()
  void refreshDeletionStatus()
  clockTimer = setInterval(() => {
    clock.value = Date.now()
  }, 60_000)
})

onBeforeUnmount(() => {
  if (clockTimer)
    clearInterval(clockTimer)
})

// 复制成功后按钮原地变成对勾，比全局提示更贴近操作
const uidCopied = ref(false)
let uidCopiedTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(uidCopiedTimer))

async function copyUid() {
  if (!user.value?.id)
    return
  try {
    await navigator.clipboard.writeText(user.value.id)
    uidCopied.value = true
    clearTimeout(uidCopiedTimer)
    uidCopiedTimer = setTimeout(() => {
      uidCopied.value = false
    }, 1600)
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
  <div class="flex flex-col gap-6">
    <AppSection title="账户状态" description="身份、会员和注销进度都在这里确认">
      <template #actions>
        <AppBadge v-if="deletionStatusLoading" color="neutral">
          <Spinner />
          正在读取
        </AppBadge>
        <AppBadge v-else-if="deletionState.status === 'pending'" color="warning">
          注销冷静期
        </AppBadge>
        <AppBadge v-else-if="deletionState.status === 'finalizing'" color="warning">
          正在完成注销
        </AppBadge>
        <AppBadge v-else-if="deletionState.status === 'attention_required'" color="error">
          需要人工核对
        </AppBadge>
        <AppBadge v-else-if="deletionState.status === 'completed'" color="neutral" icon="i-lucide-user-x">
          注销已完成
        </AppBadge>
        <AppBadge v-else color="success">
          正常使用
        </AppBadge>
      </template>

      <div class="divide-y divide-border">
        <div class="account-row account-membership">
          <div class="account-membership__details">
            <span class="text-sm text-muted">会员状态</span>
            <div class="account-membership__status">
              <MemberBadge v-if="isMember" variant="soft" label="已开通" />
              <AppBadge v-else color="neutral" label="未开通" />
              <span v-if="isMember && memberExpiryDate" class="ylf-caption inline-flex flex-wrap gap-x-2">
                <span class="whitespace-nowrap">{{ memberExpiryDate }}到期</span>
                <span v-if="memberExpiringSoon" class="whitespace-nowrap text-warning">剩 {{ memberDaysLeft }} 天</span>
              </span>
            </div>
          </div>
          <AppButton
            v-if="!isMember || memberExpiringSoon"
            to="/pricing"
            variant="link"
            size="lg"
            trailing-icon="i-lucide-chevron-right"
          >
            {{ isMember ? '续费' : '去开通' }}
          </AppButton>
        </div>

        <div v-if="isAdmin" class="account-row">
          <span class="shrink-0 text-sm text-muted">管理权限</span>
          <AppBadge icon="i-lucide-shield-check">
            管理员
          </AppBadge>
        </div>

        <div class="account-row">
          <span class="shrink-0 text-sm text-muted">用户 ID</span>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate font-mono text-sm text-muted">{{ user?.id }}</span>
            <AppButton
              color="neutral"
              variant="ghost"
              size="icon-lg"
              :aria-label="uidCopied ? '已复制用户 ID' : '复制用户 ID'"
              class="shrink-0"
              :class="uidCopied ? 'text-success' : ''"
              @click="copyUid"
            >
              <Transition name="uid-copy" mode="out-in">
                <Icon v-if="uidCopied" key="done" name="i-lucide-check" data-icon="inline-start" aria-hidden="true" />
                <Icon v-else key="copy" name="i-lucide-copy" data-icon="inline-start" aria-hidden="true" />
              </Transition>
            </AppButton>
            <span class="sr-only" role="status">{{ uidCopied ? '已复制用户 ID' : '' }}</span>
          </div>
        </div>

        <div class="account-row">
          <span class="shrink-0 text-sm text-muted">注册时间</span>
          <span class="text-sm">{{ joinDate }}</span>
        </div>
      </div>
    </AppSection>

    <AppSection v-if="deletionState.status === 'pending'">
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div class="flex items-start gap-3">
            <div class="account-warning-icon rounded-[var(--ylf-radius)] p-2.5">
              <Icon name="i-lucide-hourglass" class="size-5 text-warning" />
            </div>
            <div>
              <p class="text-xs font-semibold text-warning">
                30 天冷静期
              </p>
              <h3 class="ylf-section-title mt-1">
                {{ deletionRemainingLabel }}
              </h3>
              <p class="mt-1 text-sm text-muted">
                会员、云币、支付、AI、存储和第三方授权均已冻结；登录不会自动撤销注销。
              </p>
            </div>
          </div>

          <div class="mt-5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div class="account-deletion-progress h-full rounded-full bg-warning" :style="{ width: `${deletionProgress}%` }" />
          </div>

          <ol class="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <li class="rounded-[var(--ylf-radius-sm)] bg-elevated p-3">
              <span class="text-xs text-muted">01 · 已完成</span>
              <p class="mt-1 font-medium">
                提交注销申请
              </p>
            </li>
            <li class="account-warning-step rounded-[var(--ylf-radius-sm)] border p-3">
              <span class="text-xs text-warning">02 · 当前</span>
              <p class="mt-1 font-medium">
                冷静期，可撤回
              </p>
            </li>
            <li class="rounded-[var(--ylf-radius-sm)] bg-elevated p-3">
              <span class="text-xs text-muted">03 · 到期后</span>
              <p class="mt-1 font-medium">
                删除账号与认证绑定
              </p>
            </li>
          </ol>

          <p class="mt-4 text-xs leading-5 text-muted">
            预计 {{ scheduledDeletionDate }} 后处理。届时清除公开资料、关注与通知，并删除认证身份以释放用户名、GitHub、手机和邮箱绑定；订单及交易记录依法保留。
          </p>
        </div>

        <AppButton to="/account-status" variant="soft" size="lg" trailing-icon="i-lucide-arrow-right" class="lg:min-w-32">
          前往账号状态页
        </AppButton>
      </div>
    </AppSection>

    <Alert v-else-if="deletionState.status === 'finalizing'" variant="destructive">
      <Spinner />
      <AlertTitle>注销清理正在进行</AlertTitle>
      <AlertDescription>系统正在清除资料并释放登录绑定。此阶段无法撤回，请稍后重新确认。</AlertDescription>
    </Alert>

    <Alert v-else-if="deletionState.status === 'attention_required'" variant="destructive">
      <Icon name="i-lucide-triangle-alert" />
      <AlertTitle>账户注销状态需要人工核对</AlertTitle>
      <AlertDescription>
        检测到历史注销记录与当前认证状态不一致。系统不会自动删除你的认证身份，请通过私密客服渠道
        <NuxtLink to="/docs/contact" class="font-medium underline underline-offset-4">
          联系我们
        </NuxtLink>。
      </AlertDescription>
    </Alert>

    <Alert v-else-if="deletionState.status === 'completed'">
      <Icon name="i-lucide-user-x" />
      <AlertTitle>注销已完成</AlertTitle>
      <AlertDescription>认证身份与登录绑定已经删除；依法需要保留的交易记录将继续受到访问控制。</AlertDescription>
    </Alert>

    <AppSection title="账户操作">
      <div class="divide-y divide-border">
        <div class="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">
              退出登录
            </p>
            <p class="text-xs text-muted">
              只退出当前设备，不影响账号与其他设备
            </p>
          </div>
          <AppButton color="neutral" variant="outline" size="lg" icon="i-lucide-log-out" class="self-start sm:self-auto" @click="showLogoutConfirm = true">
            退出登录
          </AppButton>
        </div>

        <div v-if="deletionState.status === 'none'" class="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium">
              注销账号
            </p>
            <p class="text-xs text-muted">
              先进入 30 天冷静期，到期后删除账号和登录绑定
            </p>
          </div>
          <AppButton color="error" variant="soft" size="lg" icon="i-lucide-user-x" class="self-start sm:self-auto" @click="openDeleteConfirm">
            申请注销
          </AppButton>
        </div>
      </div>
    </AppSection>

    <AlertDialog v-model:open="showLogoutConfirm">
      <AlertDialogContent>
        <AlertDialogHeader>
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-elevated p-2">
              <Icon name="i-lucide-log-out" class="size-5" />
            </div>
            <div>
              <AlertDialogTitle>确认退出</AlertDialogTitle>
              <AlertDialogDescription>您确定要退出当前账户吗？</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">
            取消
          </AlertDialogCancel>
          <AlertDialogAction variant="destructive" size="lg" @click="handleLogout">
            确认退出
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="showDeleteConfirm">
      <AlertDialogContent class="sm:max-w-lg">
        <AlertDialogHeader>
          <div class="flex items-start gap-3">
            <div class="account-danger-icon rounded-full p-2">
              <Icon name="i-lucide-user-x" class="size-5 text-error" />
            </div>
            <div class="min-w-0">
              <AlertDialogTitle>申请注销账号</AlertDialogTitle>
              <AlertDialogDescription>提交后进入 30 天冷静期，不会立即删除</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div class="flex flex-col gap-5 px-6 pb-6">
          <div class="flex flex-col gap-3 rounded-[var(--ylf-radius)] bg-elevated p-4 text-sm">
            <div class="flex gap-2">
              <Icon name="i-lucide-calendar-clock" class="mt-0.5 size-4 shrink-0 text-warning" />
              <p><strong>冷静期内：</strong>资料、会员、云币和登录绑定保持不变，但账号功能会立即冻结；需要前往账号状态页明确恢复。</p>
            </div>
            <div class="flex gap-2">
              <Icon name="i-lucide-eraser" class="mt-0.5 size-4 shrink-0 text-error" />
              <p><strong>到期后：</strong>清除公开资料、关注与通知，并删除认证身份，释放用户名、GitHub、手机和邮箱绑定。</p>
            </div>
            <div class="flex gap-2">
              <Icon name="i-lucide-receipt-text" class="mt-0.5 size-4 shrink-0 text-muted" />
              <p><strong>仍会保留：</strong>为满足对账与合规要求，订单和交易记录依法保留。</p>
            </div>
          </div>

          <Field>
            <FieldLabel for="account-delete-confirm">
              请输入「注销」以提交申请
            </FieldLabel>
            <Input id="account-delete-confirm" v-model="deleteConfirmText" placeholder="注销" autocomplete="off" :disabled="deleting" />
          </Field>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg" :disabled="deleting">
            暂不注销
          </AlertDialogCancel>
          <AppButton color="error" variant="soft" size="lg" :disabled="!canDelete" :loading="deleting" @click="handleDeleteAccount">
            进入 30 天冷静期
          </AppButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ylf-space-3);
  padding-block: var(--ylf-space-4);
}

.account-row:first-child {
  padding-top: 0;
}

.account-row:last-child {
  padding-bottom: 0;
}

.account-membership {
  gap: var(--ylf-space-6);
}

.account-membership__details {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--ylf-space-2);
}

.account-membership__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ylf-space-1) var(--ylf-space-2);
}

.account-warning-icon,
.account-warning-step {
  color: var(--ylf-status-warning-text);
  background: var(--ylf-status-warning-soft);
}

.account-warning-step {
  border-color: var(--ylf-status-warning);
}

.account-danger-icon {
  background: var(--ylf-status-danger-soft);
}

.account-deletion-progress {
  transition: width var(--ylf-duration-slow) var(--ylf-ease-standard);
}

.uid-copy-enter-active {
  transition:
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.uid-copy-leave-active {
  transition: opacity var(--ylf-duration-exit) var(--ylf-ease-standard);
}

.uid-copy-enter-from {
  opacity: 0;
  scale: 0.4;
}

.uid-copy-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .uid-copy-enter-active,
  .uid-copy-leave-active {
    transition: none;
  }
}
</style>
