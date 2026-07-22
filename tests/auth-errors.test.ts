import { describe, expect, it } from 'vitest'

import { getAuthErrorPresentation } from '../app/composables/auth/types'

describe('auth error presentation', () => {
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
})
