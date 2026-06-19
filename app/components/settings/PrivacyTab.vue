<script setup lang="ts">
/**
 * 隐私设置：控制粉丝 / 关注列表的可见性。
 * 计数（关注数 / 粉丝数）始终公开，仅「列表明细」受此开关控制。
 */
const { user } = useTcbAuth()
const { getProfile, upsertMyProfile } = useUserProfile()
const toast = useToast()

const hideFollowers = ref(false)
const hideFollowing = ref(false)
const loading = ref(true)
const saving = ref(false)

onMounted(async () => {
  if (!user.value) {
    loading.value = false
    return
  }
  const p = await getProfile({ userId: user.value.id })
  if (p) {
    hideFollowers.value = p.hideFollowers
    hideFollowing.value = p.hideFollowing
  }
  loading.value = false
})

async function save(field: 'hideFollowers' | 'hideFollowing', value: boolean) {
  saving.value = true
  try {
    await upsertMyProfile({ [field]: value })
    toast.add({ title: '已保存', icon: 'i-lucide-check', color: 'success' })
  }
  catch {
    // 失败回滚开关状态
    if (field === 'hideFollowers')
      hideFollowers.value = !value
    else
      hideFollowing.value = !value
    toast.add({ title: '保存失败，请重试', color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="ylf-card rounded-2xl p-5 sm:p-6">
    <h2 class="mb-1 text-lg font-semibold text-highlighted">
      列表隐私
    </h2>
    <p class="mb-4 text-sm text-muted">
      控制谁能看到你的粉丝与关注列表。关注 / 粉丝<strong>数量始终公开</strong>，仅列表明细受此控制。
    </p>

    <div v-if="loading" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-xl text-muted" />
    </div>
    <div v-else class="divide-y divide-default">
      <div class="flex items-center justify-between gap-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">
            隐藏粉丝列表
          </p>
          <p class="text-xs text-muted">
            开启后，仅你本人可查看粉丝列表
          </p>
        </div>
        <USwitch
          v-model="hideFollowers"
          :disabled="saving"
          @update:model-value="save('hideFollowers', $event)"
        />
      </div>
      <div class="flex items-center justify-between gap-4 py-3.5">
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">
            隐藏关注列表
          </p>
          <p class="text-xs text-muted">
            开启后，仅你本人可查看关注列表
          </p>
        </div>
        <USwitch
          v-model="hideFollowing"
          :disabled="saving"
          @update:model-value="save('hideFollowing', $event)"
        />
      </div>
    </div>
  </div>
</template>
