<script setup lang="ts">
/**
 * 应用支持榜：按累计投币热度倒序展示。
 */
import type { LeaderboardItem } from '~/composables/useAppTips'

const props = withDefaults(defineProps<{ limit?: number }>(), { limit: 10 })

const { getLeaderboard } = useAppTips()
const { getAppBySlug } = useApps()

interface Row extends LeaderboardItem {
  name: string
}

const rows = ref<Row[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const board = await getLeaderboard(props.limit)
    rows.value = await Promise.all(board.map(async (it): Promise<Row> => {
      const app = await getAppBySlug(it.appId).catch(() => null)
      return { ...it, name: app?.name || it.appId }
    }))
  }
  finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="space-y-3">
    <h2 class="text-lg font-semibold flex items-center gap-2">
      <Icon name="i-lucide-trophy" class="text-amber-500" />
      应用支持榜
    </h2>

    <div v-if="loading" class="flex justify-center py-6">
      <Icon name="i-lucide-loader-2" class="text-2xl text-muted animate-spin" />
    </div>

    <p v-else-if="rows.length === 0" class="text-sm text-muted py-4 text-center">
      还没有应用收到投币，去支持你喜欢的应用吧～
    </p>

    <ol v-else class="space-y-2">
      <li v-for="(row, i) in rows" :key="row.appId">
        <NuxtLink
          :to="`/apps/${row.appId}`"
          class="ylf-interactive-card flex items-center gap-3 rounded-lg p-3"
        >
          <span
            class="w-6 text-center font-bold"
            :class="i < 3 ? 'text-amber-500' : 'text-muted'"
          >{{ i + 1 }}</span>
          <span class="flex-1 font-medium truncate">{{ row.name }}</span>
          <span class="inline-flex items-center gap-1 text-sm text-primary font-medium">
            <Icon name="i-lucide-coins" class="size-4" />
            {{ row.totalCoins }}
          </span>
          <span class="text-xs text-muted w-12 text-right">{{ row.supporterCount }} 人</span>
        </NuxtLink>
      </li>
    </ol>
  </section>
</template>
