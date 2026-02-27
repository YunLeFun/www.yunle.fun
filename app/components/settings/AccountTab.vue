<script setup lang="ts">
const { user, logout } = useTcbAuth()

const showLogoutConfirm = ref(false)

async function handleLogout() {
  showLogoutConfirm.value = false
  await logout()
}
</script>

<template>
  <div class="space-y-6">
    <UPageCard class="p-6">
      <h3 class="text-lg font-semibold mb-4">
        账户信息
      </h3>

      <div class="divide-y divide-default">
        <div class="flex items-center justify-between py-3">
          <span class="text-sm text-muted">用户 ID</span>
          <span class="text-sm font-mono text-muted">{{ user?.id }}</span>
        </div>
        <div class="flex items-center justify-between py-3">
          <span class="text-sm text-muted">账户角色</span>
          <UBadge
            :label="user?.role === 'ADMIN' ? '管理员' : '普通用户'"
            :color="user?.role === 'ADMIN' ? 'error' : 'neutral'"
            variant="subtle"
            size="sm"
          />
        </div>
        <div class="flex items-center justify-between py-3">
          <span class="text-sm text-muted">注册时间</span>
          <span class="text-sm">
            {{ user?.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '未知' }}
          </span>
        </div>
      </div>
    </UPageCard>

    <!-- 退出 & 危险操作 -->
    <UPageCard class="p-6">
      <h3 class="text-lg font-semibold mb-4 text-red-500">
        危险操作
      </h3>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
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
            @click="showLogoutConfirm = true"
          />
        </div>
      </div>
    </UPageCard>

    <!-- 退出确认弹窗 -->
    <UModal v-model:open="showLogoutConfirm">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-red-50 dark:bg-red-950">
              <UIcon name="i-lucide-log-out" class="text-xl text-red-500" />
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
  </div>
</template>
