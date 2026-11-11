<script setup lang="ts">
import type { SignInStatus } from '~/composables/useSignIn'
import type { CloudAchievementEvent } from '~/types/cloud-achievements'

const { refresh, record, restricted } = useCloudAchievements()
const signin = useState<SignInStatus | null>('signin_status', () => null)
const user = useState<{ id?: string } | null>('auth_user', () => null)
onUserSession(() => refresh())
watch(() => user.value?.id, (id, previous) => {
  if (id && previous)
    void refresh()
})
watch(() => signin.value?.signedToday ? signin.value.dateKey : null, (date) => {
  if (date)
    void refresh()
})

function onInteraction(event: Event) {
  if (!(event instanceof CustomEvent) || restricted.value)
    return
  const detail = event.detail as CloudAchievementEvent | undefined
  if (detail?.kind === 'poke' || (detail?.kind === 'explore' && typeof detail.appId === 'string'))
    void record(detail)
}
onMounted(() => window.addEventListener('ylf:cloud-achievement', onInteraction))
onUnmounted(() => window.removeEventListener('ylf:cloud-achievement', onInteraction))
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
