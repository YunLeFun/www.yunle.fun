/**
 * 密码认证（登录、修改、重置）和邮箱绑定
 */
import type { TcbBindVerificationData, TcbResetPasswordData } from './types'
import { getErrorMessage } from './types'

export function useTcbPassword(core: ReturnType<typeof import('./useAuthCore').useTcbAuthCore>) {
  const { auth, router, toast, loading, error, user, fetchUser } = core

  const signInWithPassword = async (params: { email?: string, phone?: string, username?: string, password: string }) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: signInError } = await auth.signInWithPassword(params)
      if (signInError)
        throw new Error(signInError.message || '密码登录失败')
      await fetchUser()
      toast.add({ title: '登录成功', description: '欢迎回来！', color: 'success' })
      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/profile')
      return data
    }
    catch (err: unknown) {
      console.error('密码登录失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '登录失败', description: getErrorMessage(err) || '用户名/邮箱/手机号或密码错误', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const requestSetPasswordOtp = async () => {
    try {
      loading.value = true
      error.value = null
      const target = user.value?.email || user.value?.phone
      if (!target)
        throw new Error('请先绑定邮箱或手机号，再设置密码')
      const { data, error: resetError } = await auth.resetPasswordForEmail(target)
      if (resetError)
        throw new Error(resetError.message || '发送验证码失败')
      toast.add({ title: '验证码已发送', description: `请查看${user.value?.email ? '邮箱' : '手机短信'}`, color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('发送验证码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '发送失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const confirmSetPassword = async (resetData: TcbResetPasswordData, nonce: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null
      if (!resetData.updateUser)
        throw new Error('设置密码回调不可用')
      const { error: updateError } = await resetData.updateUser({ nonce, password: newPassword })
      if (updateError)
        throw new Error(updateError.message || '设置密码失败')
      await fetchUser()
      toast.add({ title: '设置成功', description: '密码已成功设置', color: 'success' })
    }
    catch (err: unknown) {
      console.error('设置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '设置失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null
      const { error: resetError } = await auth.resetPasswordForOld({ old_password: oldPassword, new_password: newPassword })
      if (resetError)
        throw new Error(resetError.message || '修改密码失败')
      await fetchUser()
      toast.add({ title: '修改成功', description: '密码已成功修改', color: 'success' })
    }
    catch (err: unknown) {
      console.error('修改密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '操作失败', description: getErrorMessage(err) || '请检查密码是否正确', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const resetPassword = async (emailOrPhone: string) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: resetError } = await auth.resetPasswordForEmail(emailOrPhone)
      if (resetError)
        throw new Error(resetError.message || '发送重置链接失败')
      toast.add({ title: '验证码已发送', description: '请查看您的邮箱或手机短信', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('发送重置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '发送失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const confirmResetPassword = async (resetData: TcbResetPasswordData, nonce: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null
      if (!resetData.updateUser)
        throw new Error('重置密码回调不可用')
      const { data, error: updateError } = await resetData.updateUser({ nonce, password: newPassword })
      if (updateError)
        throw new Error(updateError.message || '重置密码失败')
      await fetchUser()
      toast.add({ title: '重置成功', description: '密码已成功重置，请使用新密码登录', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('重置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '重置失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const bindEmail = async (email: string) => {
    try {
      loading.value = true
      error.value = null
      const { data, error: updateError } = await auth.updateUser({ email })
      if (updateError)
        throw new Error(updateError.message || '发送验证码失败')
      toast.add({ title: '验证码已发送', description: '请查看您的邮箱', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('绑定邮箱失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '发送失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  const verifyBindEmail = async (bindData: TcbBindVerificationData, email: string, token: string) => {
    try {
      loading.value = true
      error.value = null
      if (!('verifyOtp' in bindData) || !bindData.verifyOtp)
        throw new Error('绑定验证回调不可用')
      const { data, error: verifyError } = await bindData.verifyOtp({ email, token })
      if (verifyError)
        throw new Error(verifyError.message || '验证码验证失败')
      await fetchUser()
      toast.add({ title: '绑定成功', description: '邮箱已成功绑定', color: 'success' })
      return data
    }
    catch (err: unknown) {
      console.error('验证绑定邮箱失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '验证失败', description: getErrorMessage(err) || '验证码错误或已过期', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    signInWithPassword,
    requestSetPasswordOtp,
    confirmSetPassword,
    changePassword,
    resetPassword,
    confirmResetPassword,
    bindEmail,
    verifyBindEmail,
  }
}
