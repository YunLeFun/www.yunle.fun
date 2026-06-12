/**
 * wxpay-client HTTP 客户端测试（注入 mock fetch）。
 */

import { describe, expect, it, vi } from 'vitest'

import { generateNonceStr } from '../../cloudfunctions/wxpay-order/lib/crypto.js'
import { queryTransactionByOutTradeNo, wxpayRequest } from '../../cloudfunctions/wxpay-order/lib/wxpay-client.js'
import { makeKeyPair } from '../_fixtures/wxpay.mjs'

const { privateKey } = makeKeyPair()
const baseClient = {
  mchId: '1234567890',
  serialNo: 'SERIAL-001',
  privateKey,
  nonceStr: () => 'fixed-nonce',
  nowSeconds: () => 1700000000,
}

describe('wxpayRequest', () => {
  it('发起 GET 请求时带 Accept-Language: zh-CN（微信 V3 强制）', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"ok":1}'),
    })
    await wxpayRequest({ ...baseClient, fetch: fetchSpy }, {
      method: 'GET',
      urlPath: '/v3/certificates',
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://api.mch.weixin.qq.com/v3/certificates')
    expect(init.headers['Accept-Language']).toBe('zh-CN')
    expect(init.headers.Accept).toBe('application/json')
    expect(init.headers.Authorization).toMatch(/^WECHATPAY2-SHA256-RSA2048 /)
    expect(init.body).toBeUndefined()
  })

  it('发起 POST 请求时带上序列化后的 JSON body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
    })
    await wxpayRequest({ ...baseClient, fetch: fetchSpy }, {
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      body: { foo: 'bar' },
    })
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.body).toBe('{"foo":"bar"}')
    expect(init.method).toBe('POST')
  })

  it('遇到 HTTP 非 2xx 抛出带 statusCode/code/detail 的 Error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 406,
      text: () => Promise.resolve('{"code":"PARAM_ERROR","message":"传入了不支持的Accept-Language"}'),
    })
    await expect(
      wxpayRequest({ ...baseClient, fetch: fetchSpy }, { method: 'GET', urlPath: '/v3/foo' }),
    ).rejects.toMatchObject({
      message: '传入了不支持的Accept-Language',
      statusCode: 406,
      code: 'PARAM_ERROR',
    })
  })

  it('响应非 JSON 时降级到 _raw', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    })
    await expect(
      wxpayRequest({ ...baseClient, fetch: fetchSpy }, { method: 'GET', urlPath: '/x' }),
    ).rejects.toMatchObject({
      statusCode: 500,
      detail: { _raw: 'Internal Server Error' },
    })
  })
})

describe('queryTransactionByOutTradeNo', () => {
  it('请求 URL 包含 out-trade-no 与 mchid', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"trade_state":"SUCCESS"}'),
    })
    const out = await queryTransactionByOutTradeNo(
      { ...baseClient, fetch: fetchSpy },
      { outTradeNo: 'YLF1234567890ABCDEF1234567890', mchId: '1234567890' },
    )
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toContain('/v3/pay/transactions/out-trade-no/YLF1234567890ABCDEF1234567890')
    expect(url).toContain('mchid=1234567890')
    expect(out).toEqual({ trade_state: 'SUCCESS' })
  })

  it('对 outTradeNo 做 URL 编码', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{}'),
    })
    await queryTransactionByOutTradeNo(
      { ...baseClient, fetch: fetchSpy },
      { outTradeNo: 'ABC/123', mchId: 'm' },
    )
    expect(fetchSpy.mock.calls[0][0]).toContain('out-trade-no/ABC%2F123')
  })
})

// 引用 generateNonceStr 避免 unused import 警告
void generateNonceStr
