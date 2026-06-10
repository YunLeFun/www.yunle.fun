import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  assertGrantablePayload,
  createAppStoreService,
  loadAppleRootCertificates,
} from '../../functions/wxpay-order/lib/appstore.js'

const CONFIG = {
  issuerId: 'issuer-1',
  keyId: 'KEY1',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
  bundleId: 'fun.yunle.apps',
}

const TX_PAYLOAD = { transactionId: '888', bundleId: 'fun.yunle.apps', productId: 'fun.yunle.apps.coin_100' }

/** 构造注入用的假 client / verifier 工厂 */
function makeDeps({ production, sandbox } = {}) {
  const behaviors = { Production: production, Sandbox: sandbox }
  const clientCalls = []
  const clientFactory = vi.fn(environment => ({
    async getTransactionInfo(transactionId) {
      clientCalls.push({ environment, transactionId })
      const behavior = behaviors[environment]
      if (!behavior)
        throw Object.assign(new Error('not found'), { httpStatusCode: 404 })
      if (behavior.error)
        throw behavior.error
      return { signedTransactionInfo: `jws-${environment}` }
    },
  }))
  const verifierFactory = vi.fn(environment => ({
    async verifyAndDecodeTransaction(signedTransactionInfo) {
      const behavior = behaviors[environment]
      if (behavior?.verifyError)
        throw behavior.verifyError
      return { ...TX_PAYLOAD, _from: signedTransactionInfo }
    },
    async verifyAndDecodeNotification(signedPayload) {
      const behavior = behaviors[environment]
      if (!behavior || behavior.verifyError)
        throw behavior?.verifyError || new Error('signature mismatch')
      return { notificationType: 'TEST', _from: signedPayload }
    },
  }))
  return { clientFactory, verifierFactory, clientCalls }
}

describe('createAppStoreService', () => {
  it('缺少配置抛错', () => {
    expect(() => createAppStoreService({ ...CONFIG, issuerId: '' })).toThrow('必填')
  })
})

describe('getVerifiedTransaction', () => {
  it('生产环境命中：查询 + 本地验签', async () => {
    const deps = makeDeps({ production: {} })
    const service = createAppStoreService(CONFIG, deps)
    const { payload, environment } = await service.getVerifiedTransaction('888')
    expect(environment).toBe('Production')
    expect(payload.transactionId).toBe('888')
    expect(payload._from).toBe('jws-Production')
    expect(deps.clientCalls).toHaveLength(1)
  })

  it('生产 404 回退沙盒', async () => {
    const deps = makeDeps({ sandbox: {} })
    const service = createAppStoreService(CONFIG, deps)
    const { environment } = await service.getVerifiedTransaction('888')
    expect(environment).toBe('Sandbox')
    expect(deps.clientCalls.map(c => c.environment)).toEqual(['Production', 'Sandbox'])
  })

  it('客户端与验签器按环境缓存复用', async () => {
    const deps = makeDeps({ production: {} })
    const service = createAppStoreService(CONFIG, deps)
    await service.getVerifiedTransaction('888')
    await service.getVerifiedTransaction('888')
    expect(deps.clientFactory).toHaveBeenCalledTimes(1)
    expect(deps.verifierFactory).toHaveBeenCalledTimes(1)
  })

  it('两个环境都查不到时抛错', async () => {
    const service = createAppStoreService(CONFIG, makeDeps())
    await expect(service.getVerifiedTransaction('888')).rejects.toThrow('交易不存在')
  })

  it('鉴权失败抛错', async () => {
    const deps = makeDeps({
      production: { error: Object.assign(new Error('unauthorized'), { httpStatusCode: 401 }) },
    })
    const service = createAppStoreService(CONFIG, deps)
    await expect(service.getVerifiedTransaction('888')).rejects.toThrow('鉴权失败')
  })

  it('验签失败向上抛出（不入账）', async () => {
    const deps = makeDeps({ production: { verifyError: new Error('chain invalid') } })
    const service = createAppStoreService(CONFIG, deps)
    await expect(service.getVerifiedTransaction('888')).rejects.toThrow('chain invalid')
  })

  it('transactionId 非纯数字直接拒绝', async () => {
    const service = createAppStoreService(CONFIG, makeDeps({ production: {} }))
    await expect(service.getVerifiedTransaction('../evil')).rejects.toThrow('transactionId 非法')
  })
})

describe('verifyNotification', () => {
  it('生产验签失败时回退沙盒', async () => {
    const deps = makeDeps({ sandbox: {} })
    const service = createAppStoreService(CONFIG, deps)
    const notification = await service.verifyNotification('signed-payload')
    expect(notification.notificationType).toBe('TEST')
  })

  it('两个环境都验签失败时拒绝', async () => {
    const service = createAppStoreService(CONFIG, makeDeps())
    await expect(service.verifyNotification('forged')).rejects.toThrow('通知验签失败')
  })
})

describe('loadAppleRootCertificates', () => {
  it('加载打包的 3 张 Apple 根证书（DER）', () => {
    const certs = loadAppleRootCertificates()
    expect(certs).toHaveLength(3)
    for (const cert of certs) {
      expect(Buffer.isBuffer(cert)).toBe(true)
      // DER 编码的证书以 SEQUENCE (0x30) 开头
      expect(cert[0]).toBe(0x30)
    }
  })
})

describe('assertGrantablePayload', () => {
  it('bundleId 不匹配抛错', () => {
    expect(() => assertGrantablePayload({ bundleId: 'com.evil.app' }, { bundleId: 'fun.yunle.apps' }))
      .toThrow('bundleId 不匹配')
  })

  it('已退款交易抛错', () => {
    expect(() => assertGrantablePayload(
      { bundleId: 'fun.yunle.apps', revocationDate: 1750000000000 },
      { bundleId: 'fun.yunle.apps' },
    )).toThrow('不可入账')
  })

  it('合法 payload 原样返回', () => {
    const payload = { bundleId: 'fun.yunle.apps', transactionId: '1' }
    expect(assertGrantablePayload(payload, { bundleId: 'fun.yunle.apps' })).toBe(payload)
  })
})
