<script setup lang="ts">
import type { DesktopDevice } from '~/composables/useDesktopDevices'
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
import { Spinner } from '@/components/ui/spinner'
import { desktopAppLabel, useDesktopDevices } from '~/composables/useDesktopDevices'

const { devices, loading, error, refresh, revoke } = useDesktopDevices()
const toast = useAppToast()

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
  <Card class="p-4 sm:p-6">
    <div class="mb-1 flex items-center justify-between gap-3">
      <h3 class="text-lg font-semibold">
        登录设备
      </h3>
      <Button
        variant="ghost"
        size="icon-xs"
        :disabled="loading"
        aria-label="刷新设备列表"
        @click="refresh"
      >
        <Spinner v-if="loading" />
        <Icon v-else name="i-lucide-refresh-cw" />
      </Button>
    </div>
    <p class="mb-3 text-xs text-muted">
      已通过账号授权登录的桌面 / 本地应用，移除后该设备需重新登录
    </p>

    <!-- 加载态 -->
    <div v-if="loading && !devices.length" class="flex justify-center py-6">
      <Spinner class="size-5 text-muted-foreground" />
    </div>

    <!-- 错误态 -->
    <div v-else-if="error" class="flex flex-col items-center gap-2 py-6 text-center">
      <Icon name="i-lucide-wifi-off" class="size-6 text-muted-foreground" />
      <p class="text-sm text-muted">
        {{ error }}
      </p>
      <Button variant="secondary" size="xs" @click="refresh">
        重试
      </Button>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!devices.length" class="flex flex-col items-center gap-2 py-6 text-center">
      <Icon name="i-lucide-monitor-smartphone" class="size-6 text-muted-foreground" />
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
            <Icon name="i-lucide-monitor" class="size-5" />
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
        <Button
          variant="destructive"
          size="xs"
          class="shrink-0"
          @click="confirmRevoke(device)"
        >
          移除
        </Button>
      </div>
    </div>

    <!-- 吊销确认弹窗 -->
    <Dialog v-model:open="showConfirm">
      <DialogContent>
        <DialogHeader>
          <div class="flex items-center gap-3">
            <div class="rounded-full bg-error-50 p-2 dark:bg-error-950">
              <Icon name="i-lucide-monitor-x" class="size-5 text-error" />
            </div>
            <div class="min-w-0">
              <DialogTitle>
                移除设备授权
              </DialogTitle>
              <DialogDescription class="truncate">
                {{ target?.deviceName || '该设备' }} 将被登出，需重新授权才能再次登录
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" :disabled="revoking" @click="showConfirm = false">
            取消
          </Button>
          <Button variant="destructive" :disabled="revoking" @click="handleRevoke">
            <Spinner v-if="revoking" />
            确认移除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>
