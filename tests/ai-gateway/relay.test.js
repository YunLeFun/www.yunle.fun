import { describe, expect, it } from 'vitest'

import { runMeteredChat } from '../../cloudfunctions/ai-gateway/lib/relay.js'

const MESSAGES = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: '我的提示是：测试' },
]

/** 造一组可断言调用次数/入参的 fake deps */
function makeDeps(overrides = {}) {
  const calls = { getBalance: [], generate: [], deduct: [] }
  const deps = {
    getBalance: async (uid) => {
      calls.getBalance.push(uid)
      return overrides.balance ?? 10
    },
    generate: async (messages) => {
      calls.generate.push(messages)
      if (overrides.generateThrows)
        throw new Error('boom')
      return overrides.content ?? '{"上联":"a","下联":"b","横批":"c","总结":"d"}'
    },
    deduct: async (params) => {
      calls.deduct.push(params)
      if (overrides.deductThrows)
        throw new Error('扣费失败')
      return { balance: overrides.deductedBalance ?? 9, deduped: overrides.deduped ?? false }
    },
  }
  return { deps, calls }
}

const input = (over = {}) => ({ uid: 'u1', cost: 1, messages: MESSAGES, bizId: 'biz-1', ...over })

describe('runMeteredChat', () => {
  it('未登录 → unauthorized，且不查余额/不生成/不扣费', async () => {
    const { deps, calls } = makeDeps()
    const res = await runMeteredChat(input({ uid: '' }), deps)
    expect(res).toEqual({ ok: false, code: 'unauthorized', message: expect.any(String) })
    expect(calls.getBalance).toHaveLength(0)
    expect(calls.generate).toHaveLength(0)
    expect(calls.deduct).toHaveLength(0)
  })

  it('余额不足 → insufficient，不生成/不扣费', async () => {
    const { deps, calls } = makeDeps({ balance: 0 })
    const res = await runMeteredChat(input(), deps)
    expect(res).toMatchObject({ ok: false, code: 'insufficient' })
    expect(calls.generate).toHaveLength(0)
    expect(calls.deduct).toHaveLength(0)
  })

  it('生成抛错 → ai_failed，不扣费（用户不为失败付费）', async () => {
    const { deps, calls } = makeDeps({ generateThrows: true })
    const res = await runMeteredChat(input(), deps)
    expect(res).toMatchObject({ ok: false, code: 'ai_failed' })
    expect(calls.deduct).toHaveLength(0)
  })

  it('生成空内容 → ai_failed，不扣费', async () => {
    const { deps, calls } = makeDeps({ content: '   ' })
    const res = await runMeteredChat(input(), deps)
    expect(res).toMatchObject({ ok: false, code: 'ai_failed' })
    expect(calls.deduct).toHaveLength(0)
  })

  it('成功 → ok，返回 content/balance，并按 cost+bizId 扣费', async () => {
    const { deps, calls } = makeDeps({ deductedBalance: 8 })
    const res = await runMeteredChat(input({ cost: 2 }), deps)
    expect(res).toEqual({ ok: true, content: expect.stringContaining('上联'), balance: 8, deduped: false })
    expect(calls.generate).toHaveLength(1)
    expect(calls.deduct).toEqual([{ amount: 2, bizId: 'biz-1' }])
  })

  it('扣费幂等命中 → 透传 deduped', async () => {
    const { deps } = makeDeps({ deductedBalance: 9, deduped: true })
    const res = await runMeteredChat(input(), deps)
    expect(res).toMatchObject({ ok: true, deduped: true, balance: 9 })
  })

  it('扣费异常 → 仍返回已生成结果 + 估算余额（balance - cost）', async () => {
    const { deps } = makeDeps({ balance: 10, deductThrows: true })
    const res = await runMeteredChat(input({ cost: 3 }), deps)
    expect(res).toMatchObject({ ok: true, balance: 7, deduped: false })
  })

  it('查余额异常 → 抛出（基础设施异常，由上层兜底 5xx，不吞成业务码）', async () => {
    const deps = {
      getBalance: async () => { throw new Error('account-api down') },
      generate: async () => '{}',
      deduct: async () => ({ balance: 0 }),
    }
    await expect(runMeteredChat(input(), deps)).rejects.toThrow('account-api down')
  })
})
