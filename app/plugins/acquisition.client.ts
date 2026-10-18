import { readPendingAcquisition } from '~/utils/acquisition-pending'
import { captureBrowserAcquisition } from '~/utils/acquisition-storage'

export default defineNuxtPlugin({
  name: 'acquisition',
  enforce: 'pre',
  setup(nuxtApp) {
    captureBrowserAcquisition()
    const ready = useState<boolean>('auth_ready', () => false)
    const user = useState<{ id: string } | null>('auth_user', () => null)
    const resume = async (trigger: 'session_recovery' | 'online') => {
      if (!readPendingAcquisition())
        return
      const userId = ready.value ? user.value?.id : undefined
      if (!userId)
        return
      // 插件属于入口 chunk：CloudBase SDK 只在确有待补记的来源时按需加载，匿名访客首屏不下载认证 SDK。
      const [{ useCloudbase }, { useAuthAcquisition }] = await Promise.all([
        import('~/composables/useCloudbase'),
        import('~/composables/auth/useAcquisition'),
      ])
      const { app, auth } = await nuxtApp.runWithContext(() => useCloudbase())
      await useAuthAcquisition(app, auth).resumeAfterSessionRecovery(userId, trigger)
    }
    nuxtApp.hook('app:mounted', () => void resume('session_recovery'))
    const online = () => void resume('online')
    window.addEventListener('online', online)
    if (import.meta.hot)
      import.meta.hot.dispose(() => window.removeEventListener('online', online))
  },
})
