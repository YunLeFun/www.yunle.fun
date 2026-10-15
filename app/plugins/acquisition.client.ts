import { useAuthAcquisition } from '~/composables/auth/useAcquisition'
import { readPendingAcquisition } from '~/utils/acquisition-pending'
import { captureBrowserAcquisition } from '~/utils/acquisition-storage'

export default defineNuxtPlugin({
  name: 'acquisition',
  enforce: 'pre',
  setup(nuxtApp) {
    captureBrowserAcquisition()
    const resume = (trigger: 'session_recovery' | 'online') => {
      if (!readPendingAcquisition())
        return
      nuxtApp.runWithContext(() => {
        const ready = useState<boolean>('auth_ready', () => false)
        const user = useState<{ id: string } | null>('auth_user', () => null)
        if (!ready.value || !user.value?.id)
          return
        const { app, auth } = useCloudbase()
        void useAuthAcquisition(app, auth).resumeAfterSessionRecovery(user.value.id, trigger)
      })
    }
    nuxtApp.hook('app:mounted', () => resume('session_recovery'))
    const online = () => resume('online')
    window.addEventListener('online', online)
    if (import.meta.hot)
      import.meta.hot.dispose(() => window.removeEventListener('online', online))
  },
})
