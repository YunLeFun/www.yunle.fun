<script setup lang="ts">
import type { CloudAchievementCollection } from '~/types/cloud-achievements'
import AchievementCloud from './AchievementCloud.vue'

const props = withDefaults(defineProps<{
  /** The owner catalog or a public projection containing only collected clouds. */
  collection?: CloudAchievementCollection | null
  title?: string
  editable?: boolean
  loading?: boolean
  saving?: boolean
  error?: string | null
}>(), { collection: null, title: '我的天空', editable: false, loading: false, saving: false, error: null })

defineEmits<{
  /** Save the chosen cloud, or null to remove it. */
  equip: [id: string | null]
  /** Retry loading the persisted collection. */
  refresh: []
}>()

const equipped = computed(() => props.collection?.items.find(item => item.id === props.collection?.equippedId))
const collectedCount = computed(() => props.collection?.items.filter(item => item.unlockedAt !== null).length ?? 0)
const previewId = shallowRef<string | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | undefined
async function preview(id: string) {
  clearTimeout(previewTimer)
  previewId.value = null
  await nextTick()
  previewId.value = id
  previewTimer = setTimeout(() => {
    previewId.value = null
  }, 1600)
}
onUnmounted(() => clearTimeout(previewTimer))
</script>

<template>
  <section class="cloud-collection" :aria-label="title" :aria-busy="loading || saving">
    <div class="cloud-collection__header">
      <div>
        <h2 class="font-[family-name:var(--ylf-font-heading)] text-lg font-semibold text-highlighted">
          {{ title }}
        </h2>
        <p class="mt-1 text-sm text-muted">
          {{ editable ? '每一朵云，都记得一段小小的经历' : `已收集 ${collectedCount} 朵云` }}
        </p>
      </div>
      <span v-if="editable && collection" class="shrink-0 text-sm tabular-nums text-muted">{{ collectedCount }} / {{ collection.items.length }} 朵</span>
    </div>

    <div v-if="error" class="cloud-collection__error" role="alert">
      <p class="text-sm">
        {{ error }}
      </p>
      <AppButton label="重新同步" size="sm" color="neutral" variant="outline" @click="$emit('refresh')" />
    </div>
    <div v-if="loading && !collection" class="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="正在加载云朵收藏">
      <div v-for="n in 3" :key="n" class="ylf-shimmer h-52 rounded-[var(--ylf-radius-lg)]" />
    </div>

    <template v-else-if="collection">
      <div v-if="equipped" class="cloud-collection__equipped">
        <button type="button" class="cloud-collection__featured-art ylf-press" :aria-label="`预览${equipped.name}效果`" @click="preview(equipped.id)">
          <AchievementCloud :effect="equipped.effect" :active="previewId === equipped.id" />
        </button>
        <div class="min-w-0 flex-1">
          <span class="text-xs text-muted">正在佩戴</span>
          <p class="mt-1 font-semibold text-highlighted">
            {{ equipped.name }}
          </p>
          <p class="mt-1 text-sm text-muted">
            {{ equipped.description }}
          </p>
        </div>
        <AppButton v-if="editable" label="摘下" size="sm" color="neutral" variant="ghost" :disabled="saving" @click="$emit('equip', null)" />
      </div>
      <p v-else-if="editable" class="mb-5 text-sm text-muted">
        挑一朵喜欢的云，让它在个人主页陪着你。
      </p>

      <ul v-if="collection.items.length" class="cloud-collection__grid">
        <li v-for="cloud in collection.items" :key="cloud.id" class="cloud-collection__item" :class="{ 'is-locked': cloud.unlockedAt === null, 'is-equipped': collection.equippedId === cloud.id }">
          <button type="button" class="cloud-collection__art ylf-press" :aria-label="`预览${cloud.name}效果`" @click="preview(cloud.id)">
            <AchievementCloud :effect="cloud.effect" :active="previewId === cloud.id" />
          </button>
          <h3 class="font-semibold text-highlighted">
            {{ cloud.name }}
          </h3>
          <p class="mt-1 text-xs leading-relaxed text-muted">
            {{ cloud.condition }}
          </p>
          <div v-if="editable" class="mt-auto pt-3">
            <template v-if="cloud.unlockedAt === null">
              <progress class="cloud-collection__progress" :value="cloud.progress" :max="cloud.goal" :aria-label="`${cloud.name}收集进度`" />
              <span class="mt-1 block text-xs tabular-nums text-muted">{{ cloud.progress }} / {{ cloud.goal }} · 待收集</span>
            </template>
            <AppButton
              v-else
              :label="collection.equippedId === cloud.id ? '已佩戴' : '佩戴'"
              :icon="collection.equippedId === cloud.id ? 'i-lucide-check' : undefined"
              :color="collection.equippedId === cloud.id ? 'primary' : 'neutral'"
              variant="soft"
              size="sm"
              :disabled="saving || collection.equippedId === cloud.id"
              class="w-full"
              @click="$emit('equip', cloud.id)"
            />
          </div>
        </li>
      </ul>
      <p v-else class="py-6 text-center text-sm text-muted">
        天空还很空，第一朵云正在路上。
      </p>
    </template>
  </section>
</template>

<style scoped>
.cloud-collection {
  padding: 20px;
  border-radius: var(--ylf-radius-lg);
  background: var(--ui-bg-elevated);
  border: 1px solid var(--ui-border-muted);
}
.cloud-collection__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.cloud-collection__equipped {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
  padding: 12px;
  border-radius: var(--ylf-radius);
  background: color-mix(in srgb, var(--ylf-palette-blue) 7%, var(--ui-bg));
}
.cloud-collection__featured-art {
  width: 110px;
  height: 88px;
  flex-shrink: 0;
}
.cloud-collection__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.cloud-collection__item {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  padding: 12px;
  text-align: center;
  border-radius: var(--ylf-radius);
  background: var(--ui-bg);
  border: 1px solid var(--ui-border-muted);
}
.cloud-collection__item.is-equipped {
  border-color: color-mix(in srgb, var(--ylf-palette-blue) 65%, var(--ui-border));
}
.cloud-collection__art {
  width: 120px;
  max-width: 100%;
  height: 92px;
  margin: 0 auto 8px;
}
.is-locked .cloud-collection__art {
  opacity: 0.6;
  filter: saturate(0.35);
}
.cloud-collection__progress {
  display: block;
  width: 100%;
  height: 5px;
  overflow: hidden;
  border: 0;
  border-radius: 4px;
  appearance: none;
  background: var(--ui-bg-accented);
  color: var(--ylf-palette-blue);
}
.cloud-collection__progress::-webkit-progress-bar {
  background: var(--ui-bg-accented);
}
.cloud-collection__progress::-webkit-progress-value {
  background: var(--ylf-palette-blue);
  border-radius: 4px;
}
.cloud-collection__progress::-moz-progress-bar {
  background: var(--ylf-palette-blue);
}
.cloud-collection__error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  color: var(--ui-text-error);
}
@media (max-width: 639px) {
  .cloud-collection {
    padding: 16px;
  }
  .cloud-collection__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cloud-collection__equipped {
    flex-wrap: wrap;
    gap: 8px;
  }
  .cloud-collection__featured-art {
    width: 76px;
    height: 66px;
  }
}
</style>
