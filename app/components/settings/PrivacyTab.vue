<script setup lang="ts">
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'

/**
 * 隐私设置：控制粉丝 / 关注列表的可见性。
 * 计数（关注数 / 粉丝数）始终公开，仅「列表明细」受此开关控制。
 */
const { user } = useTcbAuth()
const { getProfile, upsertMyProfile, syncRestricted } = useUserProfile()
const toast = useAppToast()

const hideFollowers = ref(false)
const hideFollowing = ref(false)
const notifyOnFollow = ref(true)
const loading = ref(true)
const saving = ref(false)

const SWITCHES = { hideFollowers, hideFollowing, notifyOnFollow }
type SwitchField = keyof typeof SWITCHES

interface SwitchRow {
  field: SwitchField
  label: string
  hint: string
  icon: string
  tone: 'pink' | 'cyan' | 'sun'
}

const LIST_ROWS: SwitchRow[] = [
  { field: 'hideFollowers', label: '隐藏粉丝列表', hint: '开启后，仅你本人可查看粉丝列表', icon: 'i-lucide-users', tone: 'pink' },
  { field: 'hideFollowing', label: '隐藏关注列表', hint: '开启后，仅你本人可查看关注列表', icon: 'i-lucide-user-check', tone: 'cyan' },
]
const NOTIFY_ROWS: SwitchRow[] = [
  { field: 'notifyOnFollow', label: '新增粉丝通知', hint: '有人关注你时收到站内通知', icon: 'i-lucide-bell-ring', tone: 'sun' },
]

// 保存成功后在对应开关旁短暂亮起「已保存」，比全局提示更贴近操作位置
const savedField = ref<SwitchField | null>(null)
let savedTimer: ReturnType<typeof setTimeout> | undefined
function flashSaved(field: SwitchField) {
  savedField.value = field
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => {
    savedField.value = null
  }, 1800)
}
onBeforeUnmount(() => clearTimeout(savedTimer))

onMounted(async () => {
  if (!user.value) {
    loading.value = false
    return
  }
  const p = await getProfile({ userId: user.value.id })
  if (p) {
    hideFollowers.value = p.hideFollowers
    hideFollowing.value = p.hideFollowing
    notifyOnFollow.value = p.notifyOnFollow !== false
  }
  loading.value = false
})

async function save(field: SwitchField, value: boolean) {
  if (syncRestricted.value)
    return
  saving.value = true
  try {
    const result = await upsertMyProfile({ [field]: value })
    if (!result) {
      SWITCHES[field].value = !value
      if (syncRestricted.value)
        return
      throw new Error('公开资料保存失败')
    }
    flashSaved(field)
  }
  catch {
    // 失败回滚开关状态
    SWITCHES[field].value = !value
    toast.add({ title: '保存失败，请重试', color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <TestAccountNotice v-if="syncRestricted" feature="profile-sync" />
    <Card>
      <CardHeader>
        <CardTitle>列表隐私</CardTitle>
        <CardDescription>
          控制谁能看到你的粉丝与关注列表。关注 / 粉丝<strong>数量始终公开</strong>，仅列表明细受此控制。
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div v-if="loading" class="space-y-3 py-2" aria-busy="true">
          <div v-for="n in LIST_ROWS.length" :key="n" class="ylf-shimmer h-12 rounded-xl" />
        </div>
        <div v-else class="divide-y divide-border">
          <div v-for="row in LIST_ROWS" :key="row.field" class="privacy-row">
            <span class="privacy-row__icon" :data-ylf-tone="row.tone" aria-hidden="true">
              <Icon :name="row.icon" class="size-5" />
            </span>
            <div class="min-w-0 flex-1 basis-32">
              <p class="text-sm font-medium">
                {{ row.label }}
              </p>
              <p class="text-[0.8125rem] leading-6 text-muted-foreground">
                {{ row.hint }}
              </p>
            </div>
            <Transition name="privacy-saved">
              <span v-if="savedField === row.field" class="privacy-saved" role="status">
                <Icon name="i-lucide-check" class="size-3.5" aria-hidden="true" />
                已保存
              </span>
            </Transition>
            <Switch
              v-model="SWITCHES[row.field].value"
              class="relative shrink-0 before:absolute before:-inset-y-3 before:inset-x-0"
              :disabled="saving || syncRestricted"
              :aria-label="row.label"
              @update:model-value="save(row.field, $event)"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- 通知偏好 -->
    <Card>
      <CardHeader>
        <CardTitle>通知</CardTitle>
        <CardDescription>控制你在站内收到的提醒。</CardDescription>
      </CardHeader>

      <CardContent>
        <div v-if="loading" class="py-2" aria-busy="true">
          <div class="ylf-shimmer h-12 rounded-xl" />
        </div>
        <div v-else class="divide-y divide-border">
          <div v-for="row in NOTIFY_ROWS" :key="row.field" class="privacy-row">
            <span class="privacy-row__icon" :data-ylf-tone="row.tone" aria-hidden="true">
              <Icon :name="row.icon" class="size-5" />
            </span>
            <div class="min-w-0 flex-1 basis-32">
              <p class="text-sm font-medium">
                {{ row.label }}
              </p>
              <p class="text-[0.8125rem] leading-6 text-muted-foreground">
                {{ row.hint }}
              </p>
            </div>
            <Transition name="privacy-saved">
              <span v-if="savedField === row.field" class="privacy-saved" role="status">
                <Icon name="i-lucide-check" class="size-3.5" aria-hidden="true" />
                已保存
              </span>
            </Transition>
            <Switch
              v-model="SWITCHES[row.field].value"
              class="relative shrink-0 before:absolute before:-inset-y-3 before:inset-x-0"
              :disabled="saving || syncRestricted"
              :aria-label="row.label"
              @update:model-value="save(row.field, $event)"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<style scoped>
.privacy-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding-block: 1.25rem;
  flex-wrap: wrap;
}

.privacy-row__icon {
  display: inline-flex;
  width: 3rem;
  height: 3rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--ylf-radius);
  color: var(--ylf-accent-text);
  background: var(--ylf-accent-soft);
}

.privacy-saved {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.25rem;
  border-radius: 9999px;
  padding: 0.125rem 0.5rem;
  color: var(--ylf-status-success-text);
  background: var(--ylf-status-success-soft);
  font-size: 0.75rem;
  font-weight: 500;
}

.privacy-saved-enter-active {
  transition:
    opacity var(--ylf-duration-fast) var(--ylf-ease-standard),
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.privacy-saved-leave-active {
  transition: opacity var(--ylf-duration-exit) var(--ylf-ease-standard);
}

.privacy-saved-enter-from {
  opacity: 0;
  translate: 6px 0;
  scale: 0.8;
}

.privacy-saved-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .privacy-saved-enter-active,
  .privacy-saved-leave-active {
    transition: none;
  }
}
</style>
