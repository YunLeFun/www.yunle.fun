<script setup lang="ts">
import type { Announcement, Announcements } from '~~/shared/public-content'
import { announcementRevision, visibleAnnouncements } from '~~/shared/public-content'

const { data } = usePublicContent('announcements')
const route = useRoute()
const dismissed = ref<Record<string, string>>({})
const ready = ref(false)
const now = ref(Date.now())
const storageKey = 'ylf:announcement-dismissals:v1'
const visible = computed(() => {
  if (!ready.value || !data.value)
    return []
  return visibleAnnouncements(data.value.content as Announcements, route.path, now.value)
    .filter(item => dismissed.value[item.id] !== announcementRevision(item))
})
function dismiss(item: Announcement) {
  dismissed.value = { ...dismissed.value, [item.id]: announcementRevision(item) }
  // Bound local storage even when old announcement IDs are never reused.
  dismissed.value = Object.fromEntries(Object.entries(dismissed.value).slice(-100))
  try {
    localStorage.setItem(storageKey, JSON.stringify(dismissed.value))
  }
  catch {
    /* The banner remains dismissed for this page when storage is unavailable. */
  }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      dismissed.value = Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string').slice(-100))
  }
  catch {
    dismissed.value = {}
  }
  now.value = Date.now()
  ready.value = true
  timer = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <aside v-if="visible.length" aria-label="站点公告" class="border-b border-default bg-muted">
    <AppContainer>
      <section v-for="item in visible" :key="item.id" class="flex items-start gap-3 py-3 text-sm">
        <Icon name="i-lucide-megaphone" class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div class="min-w-0 flex-1 break-words">
          <strong>{{ item.title }}</strong>
          <p v-if="item.body" class="mt-1 whitespace-pre-wrap text-muted">
            {{ item.body }}
          </p>
          <a v-if="item.url" :href="item.url" class="mt-1 inline-block text-primary underline underline-offset-4">{{ item.linkLabel }}</a>
        </div>
        <button type="button" :aria-label="`关闭公告：${item.title}`" class="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-elevated focus-visible:outline-2 focus-visible:outline-primary" @click="dismiss(item)">
          <Icon name="i-lucide-x" class="size-4" aria-hidden="true" />
        </button>
      </section>
    </AppContainer>
  </aside>
</template>
