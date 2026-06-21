<script setup lang="ts">
/**
 * 签到热力图日历（GitHub 贡献图风格）。
 *
 * 展示近一年每日签到：浅蓝=免费 1 云币、深蓝=会员 2 云币、金色=满 7 天里程碑、空=未签到。
 * 数据来自 getSignInHistory（coin_transactions 派生，可自愈）。日常云币由 app.vue 登录后
 * 自动领取，这里是历史回看 + 连续进度展示 + 手动兜底（内嵌 SignInButton）。
 */
const { user } = useTcbAuth()
const {
  signedToday,
  currentStreak,
  longestStreak,
  weekProgress,
  weekLen,
  milestoneReward,
  history,
  fetchStatus,
  fetchHistory,
} = useSignIn()

onMounted(() => {
  if (user.value) {
    fetchStatus()
    fetchHistory()
  }
})
watch(() => user.value?.id, (id) => {
  if (id) {
    fetchStatus()
    fetchHistory()
  }
})
// 手动兜底签到成功后刷新热力图（今日格点亮）
watch(signedToday, (v, old) => {
  if (v && !old)
    fetchHistory()
})

const DAY = 86_400_000
const CST_OFFSET = 8 * 60 * 60 * 1000
const WEEKS = 53
const WEEKDAY_LABELS = ['', '一', '', '三', '', '五', '']

/** CST 自然日序号 → YYYY-MM-DD（与后端 cstDateKey 对齐：idx*DAY 即该 CST 日的 UTC 午夜） */
function dateKeyOf(idx: number) {
  return new Date(idx * DAY).toISOString().slice(0, 10)
}

const grid = computed(() => {
  const map = new Map(history.value.map(d => [d.dateKey, d]))
  const todayIdx = Math.floor((Date.now() + CST_OFFSET) / DAY)
  const todayDow = new Date(todayIdx * DAY).getUTCDay()
  const firstSun = todayIdx - todayDow - (WEEKS - 1) * 7
  const weeks: { idx: number, future: boolean, level: number, milestone: boolean, title: string }[][] = []
  const monthRow = Array.from({ length: WEEKS }).fill('') as string[]
  let prevMonth = -1
  for (let c = 0; c < WEEKS; c++) {
    const colStart = firstSun + c * 7
    const m = new Date(colStart * DAY).getUTCMonth()
    if (m !== prevMonth) {
      monthRow[c] = `${m + 1}月`
      prevMonth = m
    }
    const col = []
    for (let r = 0; r < 7; r++) {
      const idx = colStart + r
      const dateKey = dateKeyOf(idx)
      const future = idx > todayIdx
      const rec = map.get(dateKey)
      const level = future ? -1 : rec ? (rec.coins >= 2 ? 2 : 1) : 0
      const milestone = !!rec?.milestone
      const title = future
        ? ''
        : `${dateKey} · ${rec ? `签到 +${rec.coins} 云币${milestone ? '（里程碑）' : ''}` : '未签到'}`
      col.push({ idx, future, level, milestone, title })
    }
    weeks.push(col)
  }
  return { weeks, monthRow }
})

const progressPct = computed(() => {
  const len = weekLen.value || 7
  return `${Math.min(100, Math.round((weekProgress.value / len) * 100))}%`
})

function cellClass(cell: { future: boolean, level: number, milestone: boolean }) {
  if (cell.future)
    return 'bg-transparent'
  if (cell.milestone)
    return 'bg-amber-400 dark:bg-amber-500'
  return ['bg-elevated', 'bg-primary/40', 'bg-primary'][cell.level] || 'bg-elevated'
}

const scroller = ref<HTMLElement | null>(null)
function scrollToToday() {
  nextTick(() => {
    if (scroller.value)
      scroller.value.scrollLeft = scroller.value.scrollWidth
  })
}
onMounted(scrollToToday)
watch(() => history.value.length, scrollToToday)
</script>

<template>
  <div class="ylf-surface rounded-2xl p-5 space-y-4">
    <!-- 头部 -->
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

    <!-- 本周期进度 -->
    <div class="space-y-1">
      <div class="flex items-center justify-between text-xs text-muted">
        <span>本周期 <span class="tabular-nums">{{ weekProgress }}/{{ weekLen }}</span></span>
        <span>{{ signedToday ? '今日已签到' : '今日待领取' }}</span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div class="h-full rounded-full bg-primary transition-all" :style="{ width: progressPct }" />
      </div>
    </div>

    <!-- 热力图 -->
    <div
      ref="scroller"
      class="overflow-x-auto pb-1"
      role="img"
      :aria-label="`近一年签到热力图，累计签到 ${history.length} 天`"
    >
      <div class="inline-flex min-w-max flex-col gap-1">
        <!-- 月份标签（绝对定位避免撑开列宽） -->
        <div class="h-3 flex gap-[3px] pl-[18px]">
          <div v-for="(label, ci) in grid.monthRow" :key="ci" class="relative w-2.5 shrink-0">
            <span v-if="label" class="absolute left-0 top-0 whitespace-nowrap text-[10px] leading-none text-dimmed">{{ label }}</span>
          </div>
        </div>
        <!-- 星期标签 + 周列 -->
        <div class="flex gap-[3px]">
          <div class="w-[15px] flex flex-col gap-[3px] text-[9px] leading-none text-dimmed">
            <span v-for="(w, i) in WEEKDAY_LABELS" :key="i" class="h-2.5 flex items-center">{{ w }}</span>
          </div>
          <div v-for="(col, ci) in grid.weeks" :key="ci" class="flex flex-col gap-[3px]">
            <div
              v-for="cell in col"
              :key="cell.idx"
              class="size-2.5 rounded-[2px]"
              :class="cellClass(cell)"
              :title="cell.title"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 图例 + 手动兜底 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-1.5 text-[10px] text-dimmed">
        <span>少</span>
        <span class="size-2.5 rounded-[2px] bg-elevated" />
        <span class="size-2.5 rounded-[2px] bg-primary/40" />
        <span class="size-2.5 rounded-[2px] bg-primary" />
        <span>多</span>
        <span class="mx-0.5 opacity-50">·</span>
        <span class="size-2.5 rounded-[2px] bg-amber-400 dark:bg-amber-500" />
        <span>里程碑</span>
      </div>
      <SignInButton />
    </div>

    <p class="text-xs text-muted">
      {{ signedToday ? '今日奖励已到账，明天继续保持连续' : '每天打开云乐坊自动领取，别断签～' }}
    </p>
  </div>
</template>
