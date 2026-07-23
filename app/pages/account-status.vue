<script setup lang="ts">
import {
  CircleCheckIcon,
  HourglassIcon,
  InfoIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MessageSquareWarningIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  ShieldBanIcon,
  SnowflakeIcon,
  Undo2Icon,
} from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'

definePageMeta({ layout: false })

useSeoMeta({
  title: '账号状态',
  description: '查看账号限制、注销恢复期限与申诉方式',
})

const { access, loading, refresh, recoverAccount } = useAccountAccess()
const { user, logout } = useTcbAuth()
const toast = useToast()
const recovering = ref(false)
const showRecoverConfirm = ref(false)

const statusMeta = computed(() => {
  switch (access.value.state) {
    case 'deletion_pending':
      return {
        icon: HourglassIcon,
        label: '等待用户决定',
        title: '账号注销冷静期',
      }
    case 'deletion_finalizing':
      return {
        icon: LoaderCircleIcon,
        label: '正在安全清理',
        title: '账号正在完成注销',
      }
    case 'admin_banned':
      return {
        icon: ShieldBanIcon,
        label: '访问受到限制',
        title: '账号已被封禁',
      }
    case 'unavailable':
      return {
        icon: ShieldAlertIcon,
        label: '状态核验异常',
        title: '暂时无法核验账号状态',
      }
    default:
      return {
        icon: CircleCheckIcon,
        label: '访问不受限制',
        title: '账号状态正常',
      }
  }
})

function formatChinaTime(value?: number | null) {
  if (!Number.isFinite(value))
    return '永久'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value!))
}

async function handleRecover() {
  if (!access.value.recoverable || recovering.value)
    return
  recovering.value = true
  try {
    await recoverAccount()
    showRecoverConfirm.value = false
    toast.add({
      title: '账号已恢复',
      description: '现有资料、会员、云币和登录绑定保持不变',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    await navigateTo('/')
  }
  catch (error) {
    toast.add({
      title: '恢复失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error',
    })
    await refresh(user.value?.id, true)
  }
  finally {
    recovering.value = false
  }
}

onMounted(() => {
  void refresh(user.value?.id)
})
</script>

<template>
  <div
    data-slot="account-status-page"
    class="relative isolate min-h-dvh"
  >
    <div
      data-slot="account-status-background"
      class="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <div class="absolute inset-0 bg-background" />
      <div
        class="absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl sm:size-96"
      />
      <div
        class="absolute right-[-7rem] bottom-[-5rem] size-64 rounded-full bg-warning/15 blur-3xl sm:size-80"
      />
    </div>

    <main
      class="account-status-main relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:px-6 sm:py-10"
    >
      <Card class="w-full gap-0 rounded-3xl py-0 shadow-xl">
        <CardHeader
          class="rounded-none border-b border-border bg-gradient-to-br from-warning/15 via-card to-destructive/10 px-5 py-5 sm:px-7 sm:py-6"
        >
          <div class="flex min-w-0 items-start gap-4">
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-warning/25 bg-card text-warning shadow-sm sm:size-14"
            >
              <component
                :is="statusMeta.icon"
                aria-hidden="true"
                :class="{ 'animate-spin': access.state === 'deletion_finalizing' }"
              />
            </div>

            <div class="min-w-0 flex-1 pt-0.5">
              <p class="text-xs leading-5 font-semibold tracking-[0.16em] text-muted-foreground uppercase">
                Account status
              </p>
              <CardTitle class="mt-0.5 text-xl font-semibold text-balance sm:text-2xl">
                <h1>{{ statusMeta.title }}</h1>
              </CardTitle>
              <CardDescription class="mt-1 text-xs">
                {{ statusMeta.label }}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent class="flex flex-col gap-4 px-4 py-5 sm:gap-5 sm:px-7 sm:py-6">
          <template v-if="access.state === 'deletion_pending'">
            <Alert variant="warning" class="rounded-2xl px-4 py-3.5">
              <SnowflakeIcon aria-hidden="true" />
              <AlertTitle>冷静期内账号功能已冻结</AlertTitle>
              <AlertDescription class="mt-1 leading-6 text-pretty">
                会员、云币、支付、AI、存储和第三方授权均已冻结。登录不会自动撤销注销，只有你主动恢复后才能继续使用。
              </AlertDescription>
            </Alert>

            <Card size="sm" class="gap-2 border border-border/70 bg-muted/55 py-4 ring-0">
              <CardHeader class="gap-1 px-4">
                <CardDescription>可恢复截止时间</CardDescription>
                <CardTitle class="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                  <time :datetime="access.scheduledAt ? new Date(access.scheduledAt).toISOString() : undefined">
                    {{ formatChinaTime(access.scheduledAt) }}
                  </time>
                </CardTitle>
              </CardHeader>
              <CardContent class="px-4">
                <p class="text-xs leading-5 text-muted-foreground">
                  中国标准时间（UTC+8）；服务端在该时刻收到并成功提交的恢复请求才有效。
                </p>
              </CardContent>
            </Card>
          </template>

          <template v-else-if="access.state === 'deletion_finalizing'">
            <Alert variant="destructive" class="rounded-2xl px-4 py-3.5">
              <LoaderCircleIcon class="animate-spin" aria-hidden="true" />
              <AlertTitle>注销已进入不可撤销阶段</AlertTitle>
              <AlertDescription class="mt-1 leading-6 text-pretty">
                已超过可恢复截止时间，系统正在删除公开资料与认证身份。账号绑定将在全部清理成功后统一释放。
              </AlertDescription>
            </Alert>
            <p class="px-1 text-sm leading-6 text-muted-foreground">
              若超过 24 小时仍未完成，我们会发送延迟通知；你也可以通过私密客服渠道联系我们。
            </p>
          </template>

          <template v-else-if="access.state === 'admin_banned'">
            <Card size="sm" class="border border-border/70 bg-muted/55 ring-0">
              <CardContent class="px-4">
                <dl class="grid gap-4 text-sm">
                  <div class="grid gap-1">
                    <dt class="text-muted-foreground">
                      公开原因
                    </dt>
                    <dd class="font-medium text-foreground">
                      {{ access.publicReason }}
                    </dd>
                  </div>
                  <div class="grid gap-1">
                    <dt class="text-muted-foreground">
                      封禁期限
                    </dt>
                    <dd class="font-medium text-foreground tabular-nums">
                      {{ access.permanent ? '永久' : formatChinaTime(access.expiresAt) }}
                    </dd>
                  </div>
                  <div class="grid gap-1">
                    <dt class="text-muted-foreground">
                      案件编号
                    </dt>
                    <dd class="break-all font-mono font-medium text-foreground">
                      {{ access.caseId || '待核查' }}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </template>

          <template v-else-if="access.state === 'unavailable'">
            <Alert variant="warning" class="rounded-2xl px-4 py-3.5">
              <ShieldAlertIcon aria-hidden="true" />
              <AlertTitle>账号状态服务暂不可用</AlertTitle>
              <AlertDescription class="mt-1 leading-6 text-pretty">
                为保护账号与资产，敏感功能暂时不会放行。请稍后重试。
              </AlertDescription>
            </Alert>
          </template>
        </CardContent>

        <CardFooter
          class="flex flex-col gap-3 rounded-b-3xl border-t border-border bg-muted/35 px-4 py-4 sm:px-7 sm:py-5"
        >
          <Button
            v-if="access.state === 'deletion_pending'"
            variant="brand"
            size="lg"
            class="min-h-12 w-full"
            :disabled="!access.recoverable || loading || recovering"
            @click="showRecoverConfirm = true"
          >
            <Spinner v-if="recovering" />
            <Undo2Icon v-else data-icon="inline-start" />
            {{ recovering ? '正在恢复…' : '恢复账号' }}
          </Button>

          <Button
            v-else-if="access.state === 'admin_banned'"
            as-child
            variant="brand"
            size="lg"
            class="min-h-12 w-full"
          >
            <NuxtLink :to="access.appealUrl || '/docs/contact?topic=appeal'">
              <MessageSquareWarningIcon data-icon="inline-start" />
              提交申诉
            </NuxtLink>
          </Button>

          <Button
            v-else-if="access.state === 'unavailable'"
            variant="brand"
            size="lg"
            class="min-h-12 w-full"
            :disabled="loading"
            @click="refresh(user?.id, true)"
          >
            <Spinner v-if="loading" />
            <RefreshCwIcon v-else data-icon="inline-start" />
            {{ loading ? '正在检查…' : '重新检查' }}
          </Button>

          <Button
            variant="outline"
            size="lg"
            class="min-h-12 w-full"
            @click="logout"
          >
            <LogOutIcon data-icon="inline-start" />
            退出登录
          </Button>
        </CardFooter>
      </Card>
    </main>

    <Dialog v-model:open="showRecoverConfirm">
      <DialogContent class="max-w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHeader>
          <div class="flex items-start gap-3 pr-8">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Undo2Icon aria-hidden="true" />
            </div>
            <div class="grid gap-1.5 text-left">
              <DialogTitle>确认恢复账号</DialogTitle>
              <DialogDescription class="leading-5">
                恢复后账号功能将重新开放，现有资料、会员、云币和登录绑定保持不变。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div class="px-6 pb-5">
          <Alert variant="info" class="rounded-xl px-3 py-3">
            <InfoIcon aria-hidden="true" />
            <AlertTitle>仅由本次确认触发</AlertTitle>
            <AlertDescription class="mt-1 leading-5">
              登录或打开邮件不会自动撤销注销申请。
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter class="pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:pb-4">
          <DialogClose as-child>
            <Button variant="outline" class="min-h-11 w-full sm:w-auto" :disabled="recovering">
              继续注销
            </Button>
          </DialogClose>
          <Button
            variant="brand"
            class="min-h-11 w-full sm:w-auto"
            :disabled="!access.recoverable || loading || recovering"
            @click="handleRecover"
          >
            <Spinner v-if="recovering" />
            <Undo2Icon v-else data-icon="inline-start" />
            {{ recovering ? '正在恢复…' : '确认恢复' }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.account-status-main {
  justify-content: flex-start;
}

@media (min-height: 700px) {
  .account-status-main {
    justify-content: center;
  }
}
</style>
