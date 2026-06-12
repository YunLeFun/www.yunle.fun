/**
 * OAuth 登录和第三方身份绑定/解绑
 */
import { getErrorMessage } from './types'

export function useTcbOAuth(core: ReturnType<typeof import('./useAuthCore').useTcbAuthCore>) {
  const { auth, router, toast, loading, error, fetchUser } = core

  /**
   * OAuth 登录
   * 使用 redirectTo 统一回调到 /auth/callback，
   * 确保 GitHub OAuth App 只需配置一个回调 URL
   */
  const loginWithOAuth = async (provider: 'github' | 'wx_open') => {
    try {
      loading.value = true
      error.value = null
      const currentRoute = router.currentRoute.value.fullPath
      if (currentRoute !== '/login')
        localStorage.setItem('auth_redirect', currentRoute)

      const callbackUrl = `${window.location.origin}/auth/callback`
      const { error: oauthError } = await auth.signInWithOAuth({
        provider,
        options: { redirectTo: callbackUrl },
      })
      if (oauthError)
        throw new Error(oauthError.message || 'OAuth 登录失败')
      // SDK 会自动执行 window.location.assign 跳转到授权页面
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

  /**
   * 绑定第三方身份（弹窗模式）
   * 使用 signInWithOAuth + skipBrowserRedirect 获取授权 URL，
   * 在新窗口中打开授权页面，回调到 /auth/callback 完成绑定，
   * 通过 postMessage 通知父窗口刷新用户信息。
   */
  const linkIdentity = async (provider: string) => {
    try {
      loading.value = true
      error.value = null

      // 标记绑定模式，供 /auth/callback 页面识别
      localStorage.setItem('auth_link_provider', provider)

      // 使用 skipBrowserRedirect 阻止 SDK 自动跳转，获取授权 URL
      // 同时指定 redirectTo 为 /auth/callback，统一回调入口
      const callbackUrl = `${window.location.origin}/auth/callback`
      const { data, error: oauthError } = await auth.signInWithOAuth({
        provider,
        options: {
          skipBrowserRedirect: true,
          redirectTo: callbackUrl,
          type: 'bind_identity',
        },
      })
      if (oauthError)
        throw new Error(oauthError.message || '绑定失败')
      if (!data?.url)
        throw new Error('未获取到授权地址')

      // 弹窗打开授权页面
      const width = 600
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2
      const popup = window.open(
        data.url,
        'oauth_bind',
        `width=${width},height=${height},left=${left},top=${top},popup=yes`,
      )

      if (!popup) {
        throw new Error('弹窗被浏览器拦截，请允许弹窗后重试')
      }

      // 监听弹窗通过 postMessage 返回的绑定结果
      await new Promise<void>((resolve, reject) => {
        let pollTimer: ReturnType<typeof setInterval>

        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin)
            return
          if (event.data?.type !== 'oauth_callback')
            return

          window.removeEventListener('message', handleMessage)
          clearInterval(pollTimer)

          if (event.data.success) {
            resolve()
          }
          else {
            reject(new Error(event.data.error || '绑定失败'))
          }
        }

        window.addEventListener('message', handleMessage)

        // 同时轮询弹窗是否被用户手动关闭
        pollTimer = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollTimer)
            window.removeEventListener('message', handleMessage)
            reject(new Error('授权窗口已关闭'))
          }
        }, 500)
      })

      // 绑定成功，刷新用户信息
      await fetchUser()
      toast.add({ title: '绑定成功', description: `已成功绑定${provider === 'github' ? ' GitHub' : '微信'}账号`, color: 'success' })
    }
    catch (err: unknown) {
      console.error(`绑定第三方身份失败 (${provider}):`, err)
      error.value = getErrorMessage(err)
      localStorage.removeItem('auth_link_provider')
      const msg = getErrorMessage(err)
      if (msg !== '授权窗口已关闭') {
        toast.add({ title: '绑定失败', description: msg || '请稍后重试', color: 'error' })
      }
      throw err
    }
    finally {
      loading.value = false
      localStorage.removeItem('auth_link_provider')
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
