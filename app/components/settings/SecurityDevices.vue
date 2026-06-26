<script setup lang="ts">
import type { DesktopDevice } from '~/composables/useDesktopDevices'
import { desktopAppLabel, useDesktopDevices } from '~/composables/useDesktopDevices'

const { devices, loading, error, refresh, revoke } = useDesktopDevices()
const toast = useToast()

const showConfirm = ref(false)
const revoking = ref(false)
const target = ref<DesktopDevice | null>(null)

function formatLastSeen(ts?: number) {
  if (!ts)
    return '未知'
  const diff = Date.now() - ts
  const day = 24 * 60 * 60 * 1000
  if (diff < 60 * 1000)
    return '刚刚活跃'
  if (diff < 60 * 60 * 1000)
    return `${Math.floor(diff / (60 * 1000))} 分钟前活跃`
  if (diff < day)
    return `${Math.floor(diff / (60 * 60 * 1000))} 小时前活跃`
  if (diff < 7 * day)
    return `${Math.floor(diff / day)} 天前活跃`
  return `${new Date(ts).toLocaleDateString('zh-CN')} 活跃`
}

function confirmRevoke(device: DesktopDevice) {
  target.value = device
  showConfirm.value = true
}

async function handleRevoke() {
  if (!target.value)
    return
  revoking.value = true
  try {
    const ok = await revoke(target.value.appId, target.value.deviceId)
    if (ok) {
      toast.add({ title: '已移除该设备授权', icon: 'i-lucide-check', color: 'success' })
      showConfirm.value = false
      target.value = null
    }
    else {
      toast.add({ title: '移除失败，请重试', color: 'error' })
    }
  }
  catch {
    toast.add({ title: '移除失败，请重试', color: 'error' })
  }
  finally {
    revoking.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <UPageCard class="p-4 sm:p-6">
    <div class="mb-1 flex items-center justify-between gap-3">
      <h3 class="text-lg font-semibold">
        登录设备
      </h3>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading"
        aria-label="刷新设备列表"
        @click="refresh"
      />
    </div>
    <p class="mb-3 text-xs text-muted">
      已通过账号授权登录的桌面 / 本地应用，移除后该设备需重新登录
    </p>

    <!-- 加载态 -->
    <div v-if="loading && !devices.length" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="flex flex-col items-center gap-2 py-6 text-center">
      <UIcon name="i-lucide-wifi-off" class="text-2xl text-muted" />
      <p class="text-sm text-muted">
        {{ error }}
      </p>
      <UButton label="重试" color="neutral" variant="subtle" size="xs" @click="refresh" />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!devices.length" class="flex flex-col items-center gap-2 py-6 text-center">
      <UIcon name="i-lucide-monitor-smartphone" class="text-2xl text-muted" />
      <p class="text-sm text-muted">
        暂无已授权的应用设备
      </p>
    </div>

    <!-- 设备列表 -->
    <div v-else class="divide-y divide-default">
      <div
        v-for="device in devices"
        :key="`${device.appId}:${device.deviceId}`"
        class="flex items-center justify-between gap-3 py-4"
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <div class="size-9 flex shrink-0 items-center justify-center rounded-lg bg-elevated">
            <UIcon name="i-lucide-monitor" class="text-lg" />
          </div>
          <div class="min-w-0 space-y-1">
            <p class="truncate text-sm font-medium">
              {{ device.deviceName || '未命名设备' }}
            </p>
            <p class="truncate text-xs text-muted">
              {{ desktopAppLabel(device.appId) }} · {{ formatLastSeen(device.lastSeenAt) }}
            </p>
          </div>
        </div>
        <UButton
          label="移除"
          color="error"
          variant="ghost"
          size="xs"
          class="shrink-0"
          @click="confirmRevoke(device)"
        />
      </div>
    </div>

    <!-- 吊销确认弹窗 -->
    <UModal v-model:open="showConfirm">
      <template #content>
        <div class="space-y-4 p-6">
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-error-50 p-2 dark:bg-error-950">
              <UIcon name="i-lucide-monitor-x" class="text-xl text-error" />
            </div>
            <div class="min-w-0">
              <h3 class="font-semibold">
                移除设备授权
              </h3>
              <p class="truncate text-sm text-muted">
                {{ target?.deviceName || '该设备' }} 将被登出，需重新授权才能再次登录
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="showConfirm = false"
            />
            <UButton
              label="确认移除"
              color="error"
              :loading="revoking"
              @click="handleRevoke"
            />
          </div>
        </div>
      </template>
    </UModal>
  </UPageCard>
</template>
