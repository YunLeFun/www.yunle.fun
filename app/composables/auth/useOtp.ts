/**
 * OTP 认证（手机号/邮箱验证码登录与注册）
 */
import type { TcbOtpData, TcbSignUpData } from './types'
import { getAuthErrorPresentation } from './types'

export function useTcbOtp(core: ReturnType<typeof import('./useAuthCore').useTcbAuthCore>) {
  const { auth, router, toast, loading, error, fetchUser } = core

  function showErrorToast(presentation: ReturnType<typeof getAuthErrorPresentation>, fallbackDescription: string) {
    toast.add({
      title: presentation.title,
      description: presentation.description || fallbackDescription,
      color: 'error',
      ...(presentation.supportUrl
        ? {
            duration: 10_000,
            action: {
              label: '联系客服',
              href: presentation.supportUrl,
              target: '_blank' as const,
            },
          }
        : {}),
    })
  }

  const sendPhoneOtp = async (phone: string) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: otpError } = await auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: true },
      })
      if (otpError)
        throw otpError
      toast.add({ title: '验证码已发送', description: '请查看手机短信', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('发送验证码失败:', err)
      const presentation = getAuthErrorPresentation(err, '发送失败')
      error.value = presentation.description
      showErrorToast(presentation, '请稍后重试')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const verifyPhoneOtp = async (otpData: TcbOtpData, token: string) => {
    try {
      loading.value = true
      error.value = null
      if (!otpData.verifyOtp)
        throw new Error('OTP 验证回调不可用')
      const { data, error: verifyError } = await otpData.verifyOtp({ token })
      if (verifyError)
        throw verifyError
      await fetchUser()
      toast.add({ title: '登录成功', description: '欢迎回来！', color: 'success' })
      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')
      return data
    }
    catch (err: unknown) {
      console.error('验证失败:', err)
      const presentation = getAuthErrorPresentation(err, '验证失败')
      error.value = presentation.description
      showErrorToast(presentation, '验证码错误或已过期')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const signUpWithPhone = async (phone: string) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: signUpError } = await auth.signUp({ phone } as Parameters<typeof auth.signUp>[0])
      if (signUpError)
        throw signUpError
      toast.add({ title: '验证码已发送', description: '请查看手机短信', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('注册失败:', err)
      const presentation = getAuthErrorPresentation(err, '注册失败')
      error.value = presentation.description
      showErrorToast(presentation, '请稍后重试')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const verifySignUpOtp = async (signUpData: TcbSignUpData, token: string) => {
    try {
      loading.value = true
      error.value = null
      if (!signUpData.verifyOtp)
        throw new Error('注册验证回调不可用')
      const { data, error: verifyError } = await signUpData.verifyOtp({ token })
      if (verifyError)
        throw verifyError
      await fetchUser()
      toast.add({ title: '注册成功', description: '欢迎加入！', color: 'success' })
      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')
      return data
    }
    catch (err: unknown) {
      console.error('注册验证失败:', err)
      const presentation = getAuthErrorPresentation(err, '验证失败')
      error.value = presentation.description
      showErrorToast(presentation, '验证码错误或已过期')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const sendEmailOtp = async (email: string) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: otpError } = await auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
      if (otpError)
        throw otpError
      toast.add({ title: '验证码已发送', description: '请查看您的邮箱', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('发送邮箱验证码失败:', err)
      const presentation = getAuthErrorPresentation(err, '发送失败')
      error.value = presentation.description
      showErrorToast(presentation, '请稍后重试')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const verifyEmailOtp = async (otpData: TcbOtpData, token: string) => {
    try {
      loading.value = true
      error.value = null
      if (!otpData.verifyOtp)
        throw new Error('OTP 验证回调不可用')
      const { data, error: verifyError } = await otpData.verifyOtp({ token })
      if (verifyError)
        throw verifyError
      await fetchUser()
      toast.add({ title: '登录成功', description: '欢迎回来！', color: 'success' })
      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')
      return data
    }
    catch (err: unknown) {
      console.error('邮箱验证失败:', err)
      const presentation = getAuthErrorPresentation(err, '验证失败')
      error.value = presentation.description
      showErrorToast(presentation, '验证码错误或已过期')
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    sendPhoneOtp,
    verifyPhoneOtp,
    signUpWithPhone,
    verifySignUpOtp,
    sendEmailOtp,
    verifyEmailOtp,
  }
}
