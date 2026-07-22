import { describe, expect, it } from 'vitest'

import { normalizeAccountAccessResponse } from '../app/composables/useAccountAccess'

describe('account access response boundary', () => {
  it('兼容 CloudBase 标准 envelope 和旧版直返对象', () => {
    expect(normalizeAccountAccessResponse({
      result: { state: 'admin_banned', restricted: true, caseId: 'BAN-1' },
    })).toMatchObject({ state: 'admin_banned', restricted: true, caseId: 'BAN-1' })
    expect(normalizeAccountAccessResponse({ state: 'active', restricted: false }))
      .toEqual({ state: 'active', restricted: false })
  })

  it('异常或未知响应一律失败关闭', () => {
    expect(normalizeAccountAccessResponse(null)).toEqual({ state: 'unavailable', restricted: true })
    expect(normalizeAccountAccessResponse({ result: { state: 'active' } }))
      .toEqual({ state: 'unavailable', restricted: true })
    expect(normalizeAccountAccessResponse({ result: { state: 'unknown', restricted: false } }))
      .toEqual({ state: 'unavailable', restricted: true })
  })
})
