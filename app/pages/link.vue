<script setup lang="ts">
/**
 * 设备授权页（/link）—— 桌面 / 本地应用登录的「浏览器授权」环节。
 *
 * 桌面应用发起设备授权后会用系统浏览器打开本页（带 ?code=WXYZ-1234），
 * 已登录用户在此核对应用与权限范围、点「授权」，把设备码绑定到当前账号。
 * 设计：docs/desktop-sso.md §3；接入手册：docs/desktop-sso-integration.md。
 *
 * 鉴权：本页是受保护路由（不在 isPublicAuthRoute 白名单），全局中间件已保证
 * 进入时为登录态——未登录会被自动重定向到 /login?redirect=/link?code=... 并回流。
 */

definePageMeta({ layout: 'auth' })

const route = useRoute()
const { app } = useCloudbase()
const { user } = useTcbAuth()
const toast = useAppToast()

/** scope → 人话权限描述 */
const SCOPE_LABELS: Record<string, string> = {
  'membership:read': '读取你的会员等级与到期时间',
}

type Status = 'input' | 'loading' | 'ready' | 'approving' | 'approved' | 'denied' | 'error'
const status = ref<Status>('loading')
const codeInput = ref('')
const message = ref('')
const device = ref<{
  issuer: string
  clientId: string
  appId: string
  displayName: string
  deviceName: string
  scope: string[]
  consent: 'explicit'
  expireAt: number
} | null>(null)

const appName = computed(() => device.value?.displayName || '')
const displayName = computed(() => user.value?.nickname || user.value?.login || '已登录用户')

/** 调用 desktop-auth 云函数（携带浏览器登录态） */
async function callDesktopAuth<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const { result } = await app.callFunction({ name: 'desktop-auth', data: { action, ...data } })
  return result as T
}

/** 拉取设备码对应的应用信息用于展示 */
async function describe(rawCode: string) {
  status.value = 'loading'
  message.value = ''
  try {
    device.value = await callDesktopAuth('describeDevice', { userCode: rawCode })
    status.value = 'ready'
  }
  catch (err: unknown) {
    status.value = 'error'
    message.value = err instanceof Error ? err.message : '设备码无效或已过期'
  }
}

async function approve() {
  if (!device.value)
    return
  status.value = 'approving'
  try {
    await callDesktopAuth('approveDevice', { userCode: codeInput.value })
    status.value = 'approved'
  }
  catch (err: unknown) {
    status.value = 'ready'
    toast.add({ title: '授权失败', description: err instanceof Error ? err.message : '请重试', color: 'error' })
  }
}

async function deny() {
  try {
    await callDesktopAuth('denyDevice', { userCode: codeInput.value })
  }
  catch {}
  status.value = 'denied'
}

onMounted(() => {
  const code = (route.query.code as string | undefined)?.trim()
  if (code) {
    codeInput.value = code
    describe(code)
  }
  else {
    status.value = 'input'
  }
})
</script>

<template>
  <div class="text-center space-y-6">
    <!-- 手输短码（未携带 code 时） -->
    <template v-if="status === 'input'">
      <Icon name="i-lucide-monitor-smartphone" class="mx-auto h-14 w-14 text-primary" />
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">
          连接桌面应用
        </h1>
        <p class="text-muted">
          请输入桌面应用上显示的授权码
        </p>
      </div>
      <div class="flex flex-col gap-3">
        <AppInput
          v-model="codeInput"
          placeholder="WXYZ-1234"
          size="lg"
          autofocus
          class="text-center"
          @keyup.enter="describe(codeInput)"
        />
        <AppButton size="lg" block :disabled="!codeInput.trim()" @click="describe(codeInput)">
          继续
        </AppButton>
      </div>
    </template>

    <!-- 加载中 -->
    <template v-else-if="status === 'loading'">
      <Icon name="i-lucide-loader-circle" class="mx-auto h-14 w-14 animate-spin text-primary" />
      <p class="text-muted">
        正在读取授权请求...
      </p>
    </template>

    <!-- 授权确认 -->
    <template v-else-if="status === 'ready' || status === 'approving'">
      <Icon name="i-lucide-shield-check" class="mx-auto h-14 w-14 text-primary" />
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">
          授权 {{ appName }}
        </h1>
        <p class="text-muted">
          以 <span class="font-medium text-default">{{ displayName }}</span> 的身份登录
        </p>
      </div>

      <div class="rounded-2xl bg-elevated/50 p-4 text-left space-y-3">
        <p class="text-sm text-muted">
          该应用将获得以下权限：
        </p>
        <ul class="space-y-2">
          <li v-for="s in device?.scope || []" :key="s" class="flex items-center gap-2 text-sm">
            <Icon name="i-lucide-check" class="h-4 w-4 text-green-500" />
            <span>{{ SCOPE_LABELS[s] || s }}</span>
          </li>
        </ul>
        <p class="text-xs text-dimmed">
          授权码：{{ codeInput.toUpperCase() }} · 设备：{{ device?.deviceName || '未命名设备' }}
          · 客户端：{{ device?.clientId }}
        </p>
      </div>

      <div class="flex gap-3">
        <AppButton color="neutral" variant="subtle" size="lg" block :disabled="status === 'approving'" @click="deny">
          拒绝
        </AppButton>
        <AppButton size="lg" block :loading="status === 'approving'" @click="approve">
          授权
        </AppButton>
      </div>
      <p class="text-xs text-dimmed">
        基础功能无需登录即可使用；此授权只允许应用读取会员权益，不包含云币或其他账号操作。
      </p>
    </template>

    <!-- 授权成功 -->
    <template v-else-if="status === 'approved'">
      <Icon name="i-lucide-check-circle" class="mx-auto h-14 w-14 text-green-500" />
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">
          授权成功
        </h1>
        <p class="text-muted">
          请回到 {{ appName || '桌面应用' }}，它会在几秒内完成登录。可以关闭本页了。
        </p>
      </div>
    </template>

    <!-- 已拒绝 -->
    <template v-else-if="status === 'denied'">
      <Icon name="i-lucide-x-circle" class="mx-auto h-14 w-14 text-amber-500" />
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">
          已拒绝授权
        </h1>
        <p class="text-muted">
          桌面应用不会获得你的账号权限。可以关闭本页了。
        </p>
      </div>
    </template>

    <!-- 出错 -->
    <template v-else>
      <Icon name="i-lucide-alert-triangle" class="mx-auto h-14 w-14 text-red-500" />
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">
          无法授权
        </h1>
        <p class="text-muted">
          {{ message || '设备码无效或已过期，请回到应用重新发起。' }}
        </p>
      </div>
      <AppButton variant="subtle" size="lg" @click="status = 'input'">
        手动输入授权码
      </AppButton>
    </template>
  </div>
</template>
