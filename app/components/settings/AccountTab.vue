<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
    <Card class="overflow-hidden p-0">
      <div class="border-b border-default bg-gradient-to-br from-primary-50/80 via-default to-warning-50/50 px-6 py-5 dark:from-primary-950/30 dark:to-warning-950/20">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
              Account status
            </p>
            <h3 class="mt-1 text-xl font-semibold">
              账户状态
            </h3>
            <p class="mt-1 text-sm text-muted">
              身份、会员和注销进度都在这里确认
            </p>
          </div>
          <Badge v-if="deletionStatusLoading" variant="outline">
            <Spinner />
            正在读取
          </Badge>
          <Badge v-else-if="deletionState.status === 'pending'" variant="outline" class="border-warning/35 bg-warning/10 text-warning">
            <Icon name="i-lucide-clock-3" />
            注销冷静期
          </Badge>
          <Badge v-else-if="deletionState.status === 'finalizing'" variant="destructive">
            <Spinner />
            正在完成注销
          </Badge>
          <Badge v-else-if="deletionState.status === 'attention_required'" variant="destructive">
            <Icon name="i-lucide-triangle-alert" />
            需要人工核对
          </Badge>
          <Badge v-else-if="deletionState.status === 'completed'" variant="secondary">
            <Icon name="i-lucide-user-x" />
            注销已完成
          </Badge>
          <Badge v-else variant="outline" class="border-success/35 bg-success/10 text-success">
            <Icon name="i-lucide-circle-check" />
            正常使用
          </Badge>
        </div>
      </div>

      <div class="px-6 py-2">
        <div class="divide-y divide-default">
          <div class="flex items-center justify-between gap-3 py-4">
            <span class="shrink-0 text-sm text-muted">会员状态</span>
            <div v-if="isMember" class="flex flex-wrap items-center justify-end gap-2">
              <MemberBadge size="sm" variant="fill" :expire-at="membershipState?.expireAt ?? null" />
              <Button v-if="memberExpiringSoon" as-child variant="secondary" size="xs">
                <NuxtLink to="/pricing">
                  <Icon name="i-lucide-clock-alert" />
                  {{ memberDaysLeft }} 天后到期 · 续费
                </NuxtLink>
              </Button>
            </div>
            <div v-else class="flex items-center gap-2">
              <span class="text-sm text-muted">未开通</span>
              <Button as-child variant="secondary" size="xs">
                <NuxtLink to="/pricing">
                  <Icon name="i-lucide-sparkles" />
                  去开通
                </NuxtLink>
              </Button>
            </div>
          </div>

          <div v-if="isAdmin" class="flex items-center justify-between gap-3 py-4">
            <span class="shrink-0 text-sm text-muted">管理权限</span>
            <Badge variant="destructive">
              <Icon name="i-lucide-shield-check" />
              管理员
            </Badge>
          </div>

          <div class="flex items-center justify-between gap-3 py-4">
            <span class="shrink-0 text-sm text-muted">用户 ID</span>
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="truncate font-mono text-sm text-muted">{{ user?.id }}</span>
              <Button variant="ghost" size="icon-xs" aria-label="复制用户 ID" class="shrink-0" @click="copyUid">
                <Icon name="i-lucide-copy" />
              </Button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3 py-4">
            <span class="shrink-0 text-sm text-muted">注册时间</span>
            <span class="text-sm">{{ joinDate }}</span>
          </div>
        </div>
      </div>
    </Card>

    <Card v-if="deletionState.status === 'pending'" class="overflow-hidden border border-warning/30 p-0 ring-0">
      <div class="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <div class="flex items-start gap-3">
            <div class="rounded-xl bg-warning-50 p-2.5 dark:bg-warning-950/50">
              <Icon name="i-lucide-hourglass" class="size-5 text-warning" />
            </div>
            <div>
              <p class="text-xs font-semibold tracking-[0.16em] text-warning uppercase">
                30-day cooling period
              </p>
              <h3 class="mt-1 text-xl font-semibold">
                {{ deletionRemainingLabel }}
              </h3>
              <p class="mt-1 text-sm text-muted">
                会员、云币、支付、AI、存储和第三方授权均已冻结；登录不会自动撤销注销。
              </p>
            </div>
          </div>

          <div class="mt-5 h-1.5 overflow-hidden rounded-full bg-elevated">
            <div class="h-full rounded-full bg-warning transition-[width] duration-500" :style="{ width: `${deletionProgress}%` }" />
          </div>

          <ol class="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <li class="rounded-lg bg-elevated/60 p-3">
              <span class="text-xs text-muted">01 · 已完成</span>
              <p class="mt-1 font-medium">
                提交注销申请
              </p>
            </li>
            <li class="rounded-lg border border-warning/30 bg-warning-50/60 p-3 dark:bg-warning-950/20">
              <span class="text-xs text-warning">02 · 当前</span>
              <p class="mt-1 font-medium">
                冷静期，可撤回
              </p>
            </li>
            <li class="rounded-lg bg-elevated/60 p-3">
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

        <Button as-child variant="secondary" class="justify-center lg:min-w-32">
          <NuxtLink to="/account-status">
            前往账号状态页
            <Icon name="i-lucide-arrow-right" />
          </NuxtLink>
        </Button>
      </div>
    </Card>

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

    <Card class="p-6">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.16em] text-error uppercase">
            Account actions
          </p>
          <h3 class="mt-1 text-lg font-semibold">
            账户操作
          </h3>
        </div>
        <Icon name="i-lucide-shield-alert" class="size-5 text-error" />
      </div>

      <div class="divide-y divide-default">
        <div class="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              退出登录
            </p>
            <p class="text-xs text-muted">
              只退出当前设备，不影响账号与其他设备
            </p>
          </div>
          <Button variant="outline" size="sm" class="self-start sm:self-auto" @click="showLogoutConfirm = true">
            <Icon name="i-lucide-log-out" />
            退出登录
          </Button>
        </div>

        <div v-if="deletionState.status === 'none'" class="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              注销账号
            </p>
            <p class="text-xs text-muted">
              先进入 30 天冷静期，到期后删除账号和登录绑定
            </p>
          </div>
          <Button variant="destructive" size="sm" class="self-start sm:self-auto" @click="openDeleteConfirm">
            <Icon name="i-lucide-user-x" />
            申请注销
          </Button>
        </div>
      </div>
    </Card>

    <Dialog v-model:open="showLogoutConfirm">
      <DialogContent>
        <DialogHeader>
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-elevated p-2">
              <Icon name="i-lucide-log-out" class="size-5" />
            </div>
            <div>
              <DialogTitle>确认退出</DialogTitle>
              <DialogDescription>您确定要退出当前账户吗？</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showLogoutConfirm = false">
            取消
          </Button>
          <Button variant="destructive" @click="handleLogout">
            确认退出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showDeleteConfirm">
      <DialogContent>
        <DialogHeader>
          <div class="flex items-start gap-3">
            <div class="rounded-full bg-error-50 p-2 dark:bg-error-950">
              <Icon name="i-lucide-user-x" class="size-5 text-error" />
            </div>
            <div class="min-w-0">
              <DialogTitle>申请注销账号</DialogTitle>
              <DialogDescription>提交后进入 30 天冷静期，不会立即删除</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div class="space-y-5 px-6 pb-6">
          <div class="space-y-3 rounded-xl bg-elevated/60 p-4 text-sm">
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
        <DialogFooter>
          <Button variant="outline" :disabled="deleting" @click="showDeleteConfirm = false">
            暂不注销
          </Button>
          <Button variant="destructive" :disabled="!canDelete || deleting" @click="handleDeleteAccount">
            <Spinner v-if="deleting" />
            进入 30 天冷静期
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
