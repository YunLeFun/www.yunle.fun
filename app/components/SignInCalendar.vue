<script setup lang="ts">
/**
 * 连续签到日历（周循环 + 7 天里程碑）。
 *
 * 展示当前连续天数、本周期进度（weekLen 格，末格为里程碑大奖）。
 * 日常云币由 app.vue 登录后自动领取，这里是状态展示 + 手动兜底（内嵌 SignInButton）。
 */
const { user } = useTcbAuth()
const {
  signedToday,
  currentStreak,
  longestStreak,
  weekProgress,
  weekLen,
  milestoneReward,
  fetchStatus,
} = useSignIn()

onMounted(() => {
  if (user.value)
    fetchStatus()
})
watch(() => user.value?.id, (id) => {
  if (id)
    fetchStatus()
})

/** 一个周期的格子状态：done 已签 / isToday 今日可领 / isMilestone 周期末里程碑 */
const cells = computed(() => {
  const len = weekLen.value
  const prog = weekProgress.value
  const signed = signedToday.value
  return Array.from({ length: len }, (_, idx) => {
    const day = idx + 1
    return {
      day,
      done: day <= prog,
      isToday: !signed && day === prog + 1,
      isMilestone: day === len,
    }
  })
})
</script>

<template>
  <div class="ylf-surface rounded-2xl p-5 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="space-y-1">
        <p class="font-semibold">
          每日登录奖励
        </p>
        <p class="text-sm text-muted">
          已连续签到
          <span class="font-semibold text-primary tabular-nums">{{ currentStreak }}</span>
          天 · 满 {{ weekLen }} 天得里程碑 +{{ milestoneReward }} 云币
        </p>
      </div>
      <UBadge v-if="longestStreak > 0" color="neutral" variant="subtle" icon="i-lucide-flame">
        最长 {{ longestStreak }} 天
      </UBadge>
    </div>

    <!-- 周循环格子 -->
    <ol class="grid grid-cols-7 gap-1.5 sm:gap-2">
      <li
        v-for="cell in cells"
        :key="cell.day"
        class="flex flex-col items-center gap-1.5 rounded-xl py-2 transition-colors"
        :class="[
          cell.done ? 'bg-primary/10' : 'bg-elevated/50',
          cell.isToday ? 'ring-2 ring-primary' : '',
        ]"
      >
        <span
          class="flex size-7 items-center justify-center rounded-full"
          :class="cell.done
            ? 'bg-primary text-white'
            : cell.isMilestone ? 'bg-amber-400/15 text-amber-500' : 'bg-elevated text-dimmed'"
        >
          <UIcon v-if="cell.done" name="i-lucide-check" class="size-4" />
          <UIcon v-else-if="cell.isMilestone" name="i-lucide-gift" class="size-4" />
          <span v-else class="text-xs tabular-nums">{{ cell.day }}</span>
        </span>
        <span
          class="min-h-4 text-[10px] leading-none"
          :class="cell.isToday ? 'font-semibold text-primary' : 'text-muted'"
        >
          {{ cell.isMilestone ? `+${milestoneReward}` : cell.isToday ? '今天' : '' }}
        </span>
      </li>
    </ol>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-muted">
        {{ signedToday ? '今日奖励已到账，明天继续保持连续 🔥' : '每天打开云乐坊自动领取，别断签～' }}
      </p>
      <SignInButton />
    </div>
  </div>
</template>
