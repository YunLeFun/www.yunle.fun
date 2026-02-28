/**
 * OAuth 登录和第三方身份绑定/解绑
 */
import type { LinkIdentityReq } from './types'
import { getErrorMessage } from './types'

export function useTcbOAuth(core: ReturnType<typeof import('./useAuthCore').useTcbAuthCore>) {
  const { auth, router, toast, loading, error, fetchUser } = core

  const loginWithOAuth = async (provider: 'github' | 'wx_open') => {
    try {
      loading.value = true
      error.value = null
      const currentRoute = router.currentRoute.value.fullPath
      if (currentRoute !== '/login')
        localStorage.setItem('auth_redirect', currentRoute)

      const { data, error: oauthError } = await auth.signInWithOAuth({ provider })
      if (oauthError)
        throw new Error(oauthError.message || 'OAuth 登录失败')
      if (data?.url)
        window.location.href = data.url
      else throw new Error('未获取到授权地址')
    }
    catch (err: unknown) {
      console.error(`OAuth 登录失败 (${provider}):`, err)
      loading.value = false
      error.value = getErrorMessage(err)
      toast.add({ title: '登录失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
  }

  const loginWithGitHub = () => loginWithOAuth('github')
  const loginWithWeChat = () => loginWithOAuth('wx_open')

  const linkIdentity = async (provider: string) => {
    try {
      loading.value = true
      error.value = null
      localStorage.setItem('auth_link_provider', provider)
      localStorage.setItem('auth_redirect', router.currentRoute.value.fullPath)
      const { data, error: linkError } = await auth.linkIdentity({ provider } as LinkIdentityReq)
      if (linkError)
        throw new Error(linkError.message || '绑定失败')
      if (data?.provider)
        return data
    }
    catch (err: unknown) {
      console.error(`绑定第三方身份失败 (${provider}):`, err)
      loading.value = false
      error.value = getErrorMessage(err)
      localStorage.removeItem('auth_link_provider')
      toast.add({ title: '绑定失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
  }

  const bindGitHub = () => linkIdentity('github')
  const bindWeChat = () => linkIdentity('wx_open')

  const getUserIdentities = async () => {
    try {
      const { data, error: identityError } = await auth.getUserIdentities()
      if (identityError)
        throw new Error(identityError.message || '获取绑定信息失败')
      return data.identities || []
    }
    catch (err: unknown) {
      console.error('获取绑定身份失败:', err)
      return []
    }
  }

  const unbindIdentity = async (provider: string) => {
    try {
      loading.value = true
      error.value = null
      const { error: unlinkError } = await auth.unlinkIdentity({ provider })
      if (unlinkError)
        throw new Error(unlinkError.message || '解绑失败')
      await fetchUser()
      toast.add({ title: '解绑成功', description: '已成功解除绑定', color: 'success' })
    }
    catch (err: unknown) {
      console.error(`解绑第三方身份失败 (${provider}):`, err)
      error.value = getErrorMessage(err)
      toast.add({ title: '解绑失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    loginWithOAuth,
    loginWithGitHub,
    loginWithWeChat,
    linkIdentity,
    bindGitHub,
    bindWeChat,
    getUserIdentities,
    unbindIdentity,
  }
}
