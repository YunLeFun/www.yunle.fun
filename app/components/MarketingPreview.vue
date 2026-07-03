<script setup lang="ts">
type PreviewKind = 'marketplace' | 'developer'

const props = withDefaults(defineProps<{
  kind?: PreviewKind
  index?: number
}>(), {
  kind: 'marketplace',
  index: 0,
})

const appItems = [
  {
    name: '灵感便签',
    description: '云同步',
    icon: 'i-lucide-notebook-pen',
    status: '已收藏',
  },
  {
    name: '图片工坊',
    description: '创意工具',
    icon: 'i-lucide-image',
    status: '新上架',
  },
  {
    name: '部署面板',
    description: '开发者',
    icon: 'i-lucide-terminal-square',
    status: '热门',
  },
  {
    name: '资料库',
    description: '效率应用',
    icon: 'i-lucide-folder-kanban',
    status: '推荐',
  },
]

const deploySteps = [
  {
    label: '仓库同步',
    icon: 'i-ri-github-fill',
    value: 'main',
  },
  {
    label: '构建检查',
    icon: 'i-lucide-badge-check',
    value: 'passed',
  },
  {
    label: '边缘发布',
    icon: 'i-lucide-cloud-upload',
    value: 'live',
  },
]

const activityItems = [
  {
    label: 'API 请求',
    value: '24.8k',
    icon: 'i-lucide-radio-tower',
  },
  {
    label: '平均响应',
    value: '84ms',
    icon: 'i-lucide-gauge',
  },
  {
    label: '收藏同步',
    value: '99.9%',
    icon: 'i-lucide-refresh-cw',
  },
]

const isDeveloper = computed(() => props.kind === 'developer')
const surfaceTitle = computed(() => isDeveloper.value ? 'YunLe Deploy' : 'YunLe Apps')
const surfaceBadge = computed(() => isDeveloper.value ? 'Production' : 'App Market')
</script>

<template>
  <div class="ylf-preview-shell overflow-hidden rounded-lg p-3 sm:p-4">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <div class="flex gap-1.5">
          <span class="size-2.5 rounded-full bg-red-400" />
          <span class="size-2.5 rounded-full bg-amber-400" />
          <span class="size-2.5 rounded-full bg-green-400" />
        </div>
        <span class="truncate text-xs font-medium text-muted">{{ surfaceTitle }}</span>
      </div>
      <UBadge
        :label="surfaceBadge"
        color="primary"
        variant="subtle"
        size="xs"
      />
    </div>

    <div
      v-if="isDeveloper"
      class="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]"
    >
      <section class="ylf-soft-panel min-h-72 rounded-md p-4">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-highlighted">
              云端应用构建
            </p>
            <p class="text-xs text-muted">
              ylf/studio-app
            </p>
          </div>
          <UIcon
            name="i-lucide-circle-check"
            class="size-6 text-primary"
          />
        </div>

        <div class="space-y-3">
          <div
            v-for="step in deploySteps"
            :key="step.label"
            class="flex items-center justify-between rounded-md border border-default bg-default px-3 py-2.5"
          >
            <div class="flex items-center gap-2.5">
              <span class="ylf-icon-tile flex size-8 items-center justify-center rounded-md">
                <UIcon
                  :name="step.icon"
                  class="size-4"
                />
              </span>
              <span class="text-sm font-medium text-highlighted">{{ step.label }}</span>
            </div>
            <span class="font-mono text-xs text-muted">{{ step.value }}</span>
          </div>
        </div>

        <div class="mt-4 rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-200">
          <p class="text-blue-300">
            pnpm build
          </p>
          <p class="mt-1 text-slate-400">
            generated routes · assets optimized · deployed
          </p>
        </div>
      </section>

      <aside class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <div
          v-for="item in activityItems"
          :key="item.label"
          class="ylf-soft-panel rounded-md p-3"
        >
          <div class="mb-3 flex items-center justify-between">
            <span class="text-xs text-muted">{{ item.label }}</span>
            <UIcon
              :name="item.icon"
              class="size-4 text-primary"
            />
          </div>
          <p class="text-2xl font-semibold text-highlighted">
            {{ item.value }}
          </p>
          <div class="mt-3 h-2 overflow-hidden rounded-full bg-elevated">
            <div class="h-full w-4/5 rounded-full bg-primary" />
          </div>
        </div>
      </aside>
    </div>

    <div
      v-else
      class="grid gap-3 lg:grid-cols-[1fr_13rem]"
    >
      <section class="ylf-soft-panel min-h-72 rounded-md p-4">
        <div class="mb-4 flex items-center gap-3">
          <div class="ylf-icon-tile flex size-10 items-center justify-center rounded-md">
            <UIcon
              name="i-lucide-sparkles"
              class="size-5"
            />
          </div>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-highlighted">
              探索云端应用
            </p>
            <p class="text-xs text-muted">
              收藏、同步、分享
            </p>
          </div>
        </div>

        <div class="mb-4 flex items-center gap-2 rounded-md border border-default bg-default px-3 py-2 text-sm text-muted">
          <UIcon
            name="i-lucide-search"
            class="size-4"
          />
          <span>搜索应用、工具或创作者</span>
        </div>

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div
            v-for="item in appItems"
            :key="item.name"
            class="rounded-md border border-default bg-default p-3"
          >
            <div class="mb-3 flex items-start justify-between gap-3">
              <span class="ylf-icon-tile flex size-9 items-center justify-center rounded-md">
                <UIcon
                  :name="item.icon"
                  class="size-4"
                />
              </span>
              <UBadge
                :label="item.status"
                color="neutral"
                variant="subtle"
                size="xs"
              />
            </div>
            <p class="text-sm font-semibold text-highlighted">
              {{ item.name }}
            </p>
            <p class="text-xs text-muted">
              {{ item.description }}
            </p>
          </div>
        </div>
      </section>

      <aside class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        <div class="ylf-soft-panel rounded-md p-3">
          <p class="text-xs text-muted">
            已收录应用
          </p>
          <p class="mt-2 text-3xl font-semibold text-highlighted">
            10+
          </p>
        </div>
        <div class="ylf-soft-panel rounded-md p-3">
          <p class="text-xs text-muted">
            同步状态
          </p>
          <div class="mt-3 flex items-center gap-2 text-sm font-medium text-primary">
            <UIcon
              name="i-lucide-cloud-check"
              class="size-5"
            />
            实时在线
          </div>
        </div>
        <div class="ylf-soft-panel rounded-md p-3">
          <p class="text-xs text-muted">
            社区评分
          </p>
          <div class="mt-3 flex items-center gap-1 text-amber-500">
            <UIcon
              v-for="star in 5"
              :key="star"
              name="i-lucide-star"
              class="size-4 fill-current"
            />
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
