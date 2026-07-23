<script setup lang="ts">
definePageMeta({ layout: 'auth' })

useSeoMeta({
  title: '账号状态',
  description: '查看账号限制、注销恢复期限与申诉方式',
})

const { access, loading, refresh, recoverAccount } = useAccountAccess()
const { user, logout } = useTcbAuth()
const toast = useToast()
const recovering = ref(false)
const showRecoverConfirm = ref(false)

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
  <main class="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-4 py-12">
    <UPageCard class="w-full overflow-hidden p-0">
      <div class="border-b border-default bg-gradient-to-br from-warning-50 via-default to-error-50 px-6 py-6 dark:from-warning-950/30 dark:to-error-950/20">
        <div class="flex items-start gap-4">
          <div class="rounded-2xl bg-default p-3 shadow-sm">
            <UIcon
              :name="access.state === 'admin_banned' ? 'i-lucide-shield-ban' : 'i-lucide-hourglass'"
              class="size-7 text-warning"
            />
          </div>
          <div>
            <p class="text-xs font-semibold tracking-[0.18em] text-warning uppercase">
              Account status
            </p>
            <h1 class="mt-1 text-2xl font-semibold">
              <template v-if="access.state === 'deletion_pending'">
                账号注销冷静期
              </template>
              <template v-else-if="access.state === 'deletion_finalizing'">
                账号正在完成注销
              </template>
              <template v-else-if="access.state === 'admin_banned'">
                账号已被封禁
              </template>
              <template v-else-if="access.state === 'unavailable'">
                暂时无法核验账号状态
              </template>
              <template v-else>
                账号状态正常
              </template>
            </h1>
          </div>
        </div>
      </div>

      <div class="space-y-5 p-6">
        <template v-if="access.state === 'deletion_pending'">
          <UAlert
            title="冷静期内账号功能已冻结"
            description="会员、云币、支付、AI、存储和第三方授权均已冻结。登录不会自动撤销注销，只有你主动恢复后才能继续使用。"
            color="warning"
            variant="subtle"
            icon="i-lucide-snowflake"
          />
          <div class="rounded-xl bg-elevated/60 p-4">
            <p class="text-sm text-muted">
              可恢复截止时间
            </p>
            <p class="mt-1 text-lg font-semibold">
              {{ formatChinaTime(access.scheduledAt) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              中国标准时间（UTC+8）；服务端在该时刻收到并成功提交的恢复请求才有效。
            </p>
          </div>
          <UButton
            label="恢复账号"
            icon="i-lucide-undo-2"
            color="primary"
            block
            :loading="recovering"
            :disabled="!access.recoverable || loading"
            @click="showRecoverConfirm = true"
          />
        </template>

        <template v-else-if="access.state === 'deletion_finalizing'">
          <UAlert
            title="注销已进入不可撤销阶段"
            description="已超过可恢复截止时间，系统正在删除公开资料与认证身份。账号绑定将在全部清理成功后统一释放。"
            color="error"
            variant="subtle"
            icon="i-lucide-loader-circle"
          />
          <p class="text-sm text-muted">
            若超过 24 小时仍未完成，我们会发送延迟通知；你也可以通过私密客服渠道联系我们。
          </p>
        </template>

        <template v-else-if="access.state === 'admin_banned'">
          <div class="space-y-3 rounded-xl bg-elevated/60 p-4 text-sm">
            <div>
              <p class="text-muted">
                公开原因
              </p>
              <p class="mt-1 font-medium">
                {{ access.publicReason }}
              </p>
            </div>
            <div>
              <p class="text-muted">
                封禁期限
              </p>
              <p class="mt-1 font-medium">
                {{ access.permanent ? '永久' : formatChinaTime(access.expiresAt) }}
              </p>
            </div>
            <div>
              <p class="text-muted">
                案件编号
              </p>
              <p class="mt-1 font-mono font-medium">
                {{ access.caseId || '待核查' }}
              </p>
            </div>
          </div>
          <UButton :to="access.appealUrl || '/docs/contact?topic=appeal'" label="提交申诉" icon="i-lucide-message-square-warning" block />
        </template>

        <template v-else-if="access.state === 'unavailable'">
          <UAlert
            title="账号状态服务暂不可用"
            description="为保护账号与资产，敏感功能暂时不会放行。请稍后重试。"
            color="warning"
            variant="subtle"
          />
          <UButton label="重新检查" :loading="loading" block @click="refresh(user?.id, true)" />
        </template>

        <UButton label="退出登录" color="neutral" variant="outline" block icon="i-lucide-log-out" @click="logout" />
      </div>
    </UPageCard>

    <UModal v-model:open="showRecoverConfirm">
      <template #content>
        <div class="space-y-5 p-6">
          <div class="flex items-start gap-3">
            <div class="rounded-full bg-primary-50 p-2 dark:bg-primary-950">
              <UIcon name="i-lucide-undo-2" class="text-xl text-primary" />
            </div>
            <div>
              <h2 class="font-semibold">
                确认恢复账号
              </h2>
              <p class="text-sm text-muted">
                恢复后账号功能将重新开放，现有资料、会员、云币和登录绑定保持不变。
              </p>
            </div>
          </div>

          <UAlert
            title="这不会由登录或邮件链接自动触发"
            description="只有你在冷静期截止前点击下方确认按钮，系统才会撤销本次注销申请。"
            color="info"
            variant="subtle"
          />

          <div class="flex justify-end gap-3">
            <UButton
              label="继续注销"
              color="neutral"
              variant="outline"
              :disabled="recovering"
              @click="showRecoverConfirm = false"
            />
            <UButton
              label="确认恢复"
              color="primary"
              :loading="recovering"
              :disabled="!access.recoverable || loading"
              @click="handleRecover"
            />
          </div>
        </div>
      </template>
    </UModal>
  </main>
</template>
