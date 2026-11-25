import type { useTcbAuth } from '~/composables/useTcbAuth'

type LoginAuth = ReturnType<typeof useTcbAuth>

export function useLazyLoginAuth() {
  const nuxtApp = useNuxtApp()
  const toast = useAppToast()
  const loading = shallowRef(false)
  let auth: LoginAuth | undefined

  async function loadAuth() {
    try {
      const { useTcbAuth } = await import('~/composables/useTcbAuth')
      return nuxtApp.runWithContext(useTcbAuth)
    }
    catch (error) {
      console.warn('[auth] 登录模块加载失败:', error)
      toast.add({ title: '登录暂不可用', description: '请刷新页面后再试。', color: 'error' })
      throw error
    }
  }

  async function runAuthAction<T>(action: (auth: LoginAuth) => Promise<T>) {
    loading.value = true
    try {
      auth ??= await loadAuth()
      return await action(auth)
    }
    finally {
      loading.value = false
    }
  }

  return { loading, runAuthAction }
}
