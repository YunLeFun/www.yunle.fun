import { describe, expect, it } from 'vitest'

import {
  getAuthErrorPresentation,
  getEmailBindingErrorPresentation,
  getEmailLoginErrorPresentation,
} from '../app/composables/auth/types'

describe('auth error presentation', () => {
  it('把验证阶段的 invalid_argument 识别为验证码错误', () => {
    expect(getEmailBindingErrorPresentation({
      status: 'invalid_argument',
      message: 'raw provider verification details',
    }, 'verify')).toEqual({
      field: 'otp',
      title: '验证码无效',
      description: '验证码错误或已过期，请重新输入或获取新验证码。',
      code: 'invalid_argument',
    })
  })

  it('忽略数字 HTTP status 并继续读取 CloudBase 字符串 code', () => {
    expect(getEmailBindingErrorPresentation({
      status: 429,
      code: 'resource_exhausted',
      message: 'raw provider quota details',
    }, 'request')).toEqual({
      field: 'form',
      title: '请求过于频繁',
      description: '验证码请求过于频繁，请稍后再试。',
      code: 'resource_exhausted',
    })
  })

  it.each([
    ['status', { status: 'verification_code_expired' }],
    ['code', { code: 'verification_code_expired' }],
    ['error', { error: 'verification_code_expired' }],
  ])('通过 %s 字段识别过期验证码', (_source, providerError) => {
    expect(getEmailBindingErrorPresentation({
      ...providerError,
      message: 'raw provider verification details',
    }, 'verify')).toEqual({
      field: 'otp',
      title: '验证码无效',
      description: '验证码错误或已过期，请重新输入或获取新验证码。',
      code: 'verification_code_expired',
    })
  })

  it('网络错误使用安全的表单提示且不透传服务端原文', () => {
    const presentation = getEmailBindingErrorPresentation({
      error: 'unreachable',
      error_description: 'raw provider network and tenant details',
    }, 'request')

    expect(presentation).toEqual({
      field: 'form',
      title: '验证码发送失败',
      description: '验证码暂时无法发送，请稍后重试。',
      code: 'unreachable',
    })
  })

  it('未知错误不会把 CloudBase helpMessage 暴露给用户', () => {
    expect(getEmailBindingErrorPresentation({
      code: 'internal_provider_failure',
      message: 'provider request failed',
      helpMessage: 'raw tenant configuration and internal remediation details',
    }, 'request')).toEqual({
      field: 'form',
      title: '验证码发送失败',
      description: '验证码暂时无法发送，请稍后重试。',
      code: 'internal_provider_failure',
    })
  })

  it.each([
    'USER_NOT_FOUND',
    'user_not_found',
    'registration_not_supported',
  ])('邮箱登录拒绝不会泄露账号是否存在或展示原始错误：%s', (code) => {
    const presentation = getEmailLoginErrorPresentation({
      code,
      message: `raw provider error: ${code}`,
    })

    expect(presentation).toEqual({
      title: '无法使用邮箱登录',
      description: '该邮箱暂时无法用于登录。请检查邮箱是否正确；首次使用邮箱登录，请先通过手机号或 GitHub 登录，并在账号设置中绑定邮箱。',
      code,
    })
  })

  it('把 CloudBase user_blocked 映射为明确且不泄露内部规则的暂停登录提示', () => {
    expect(getAuthErrorPresentation({
      error: 'user_blocked',
      error_description: '该用户被停用',
    })).toEqual({
      title: '账号已暂停登录',
      description: '该账号当前已被封禁，无法继续登录。若你曾申请注销，系统可能正在完成账号清理；如有疑问，请联系客服。',
      code: 'user_blocked',
    })
  })

  it('识别业务侧待注销与管理员封禁错误', () => {
    expect(getAuthErrorPresentation({ code: 'account_deletion_pending' })).toMatchObject({
      title: '账号正在注销冷静期',
      code: 'account_deletion_pending',
    })
    expect(getAuthErrorPresentation({ code: 'account_banned' })).toMatchObject({
      title: '账号已被封禁',
      code: 'account_banned',
    })
  })

  it('普通登录错误继续使用原始安全提示', () => {
    expect(getAuthErrorPresentation(new Error('用户名或密码错误'))).toEqual({
      title: '登录失败',
      description: '用户名或密码错误',
      code: null,
    })
  })

  it('把短信免打扰名单错误映射为中文提示和私密客服入口', () => {
    const error = Object.assign(
      new Error('FailedOperation.PhoneNumberInBlacklist msg number on the blacklist'),
      {
        code: 'send_error_code',
        requestId: 'req_sms_blacklist_001',
      },
    )

    const presentation = getAuthErrorPresentation(error, '注册失败')

    expect(presentation).toMatchObject({
      title: '验证码发送失败',
      description: '该手机号当前无法接收验证码，请更换手机号或联系客服协助处理。',
      code: 'FailedOperation.PhoneNumberInBlacklist',
    })

    const supportUrl = new URL(presentation.supportUrl!)
    expect(`${supportUrl.origin}${supportUrl.pathname}`).toBe('https://support.yunle.fun/login-help')
    expect(Object.fromEntries(supportUrl.searchParams)).toEqual({
      v: '1',
      product: 'www',
      type: 'login',
      source: 'auth-otp',
      requestId: 'req_sms_blacklist_001',
      errorCode: 'FailedOperation.PhoneNumberInBlacklist',
    })
  })

  it.each([
    [
      'InvalidParameterValue.IncorrectPhoneNumber',
      '手机号格式不正确',
      '请检查手机号和国家或地区代码后重试。',
    ],
    [
      'LimitExceeded.PhoneNumberThirtySecondLimit',
      '请求过于频繁',
      '验证码请求过于频繁，请稍后再试。',
    ],
    [
      'LimitExceeded.PhoneNumberDailyLimit',
      '今日发送次数已达上限',
      '该手机号今日接收验证码的次数已达上限，请明日再试。',
    ],
    [
      'UnsupportedOperation.UnsupportedRegion',
      '暂不支持该手机号',
      '当前仅支持中国大陆手机号，请检查国家或地区代码后重试。',
    ],
  ])('为用户可以自行处理的短信错误提供明确提示：%s', (code, title, description) => {
    expect(getAuthErrorPresentation(new Error(`send_error_code ${code}`), '发送失败')).toMatchObject({
      title,
      description,
      code,
    })
  })

  it('将签名、模板、余额和服务异常统一降级，不暴露内部错误', () => {
    const presentation = getAuthErrorPresentation(
      Object.assign(new Error('FailedOperation.TemplateUnapprovedOrNotExist msg template missing'), {
        code: 'send_error_code',
      }),
      '注册失败',
    )

    expect(presentation).toMatchObject({
      title: '验证码发送失败',
      description: '验证码服务暂时不可用，请稍后重试；若仍无法发送，请联系客服。',
      code: 'FailedOperation.TemplateUnapprovedOrNotExist',
    })
    expect(presentation.supportUrl).toContain('https://support.yunle.fun/login-help?')

    expect(getAuthErrorPresentation(
      new Error('UnsupportedOperation.GlobalTemplateToChineseMainlandPhone'),
      '注册失败',
    )).toMatchObject({
      title: '验证码发送失败',
      description: '验证码服务暂时不可用，请稍后重试；若仍无法发送，请联系客服。',
      code: 'UnsupportedOperation.GlobalTemplateToChineseMainlandPhone',
    })
  })
})
