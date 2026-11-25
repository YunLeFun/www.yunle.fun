import type { Router } from 'vue-router'
import type { useAppToast } from '~/composables/useAppToast'

export async function navigateAfterAuth(
  router: Pick<Router, 'push' | 'replace' | 'resolve'>,
  toast: Pick<ReturnType<typeof useAppToast>, 'add'>,
  destination: string,
  method: 'push' | 'replace' = 'push',
) {
  try {
    await router[method](destination)
  }
  catch (error) {
    // Nuxt can already reload the destination on a chunk error. A regular link
    // also lets the user recover if the current router cannot load the page.
    console.warn('[auth] 登录或绑定后页面加载失败:', error)
    toast.add({
      id: 'auth-navigation-failed',
      title: '页面加载失败',
      description: '操作已完成，请重新打开目标页面。',
      color: 'warning',
      duration: 10_000,
      action: { label: '重新打开页面', href: router.resolve(destination).href },
    })
  }
}
