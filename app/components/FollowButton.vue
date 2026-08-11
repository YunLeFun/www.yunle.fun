<script setup lang="ts">
/**
 * 关注按钮（三态：关注 / 已关注 / 互相关注，hover 已关注态显示「取消关注」）。
 *
 * - 乐观更新 + 失败回滚（参考 AppTipButton 的交互）
 * - 未登录跳登录并带 redirect；本人不渲染
 * - emit('change', following) 供父级乐观更新被关注方的粉丝数
 */
import type { FollowRelation } from '~/types/social'

const props = withDefaults(defineProps<{
  targetId: string
  /** 父级已查到的关系，传入可免重复请求 */
  relation?: FollowRelation | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), { relation: null, size: 'md' })

const emit = defineEmits<{ (e: 'change', following: boolean): void }>()

const { user } = useTcbAuth()
const { getRelation, follow, unfollow } = useFollow()
const toast = useAppToast()
const route = useRoute()

const relation = ref<FollowRelation>(props.relation ?? { isFollowing: false, isFollowedBy: false })
const submitting = ref(false)
const hovering = ref(false)

const isSelf = computed(() => !!user.value && user.value.id === props.targetId)

async function load() {
  if (props.relation) {
    relation.value = props.relation
    return
  }
  if (!props.targetId || isSelf.value || !user.value)
    return
  relation.value = await getRelation(props.targetId)
}
onMounted(load)
watch(() => props.targetId, load)
watch(() => props.relation, (r) => {
  if (r)
    relation.value = r
})

const label = computed(() => {
  if (!relation.value.isFollowing)
    return relation.value.isFollowedBy ? '回关' : '关注'
  if (hovering.value)
    return '取消关注'
  return relation.value.isFollowedBy ? '互相关注' : '已关注'
})
const icon = computed(() => {
  if (!relation.value.isFollowing)
    return 'i-lucide-user-plus'
  if (hovering.value)
    return 'i-lucide-user-minus'
  return relation.value.isFollowedBy ? 'i-lucide-users' : 'i-lucide-user-check'
})

async function toggle() {
  if (submitting.value || isSelf.value)
    return
  if (!user.value) {
    navigateTo(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
    return
  }
  const next = !relation.value.isFollowing
  submitting.value = true
  // 乐观更新
  relation.value = { ...relation.value, isFollowing: next }
  emit('change', next)
  try {
    if (next)
      await follow(props.targetId)
    else
      await unfollow(props.targetId)
  }
  catch (err) {
    // 回滚
    relation.value = { ...relation.value, isFollowing: !next }
    emit('change', !next)
    toast.add({
      title: next ? '关注失败' : '取关失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppButton
    v-if="!isSelf"
    :icon="icon"
    :label="label"
    :color="relation.isFollowing ? 'neutral' : 'primary'"
    :variant="relation.isFollowing && hovering ? 'soft' : (relation.isFollowing ? 'outline' : 'solid')"
    :size="size"
    :loading="submitting"
    class="rounded-full"
    @click="toggle"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
  />
</template>
