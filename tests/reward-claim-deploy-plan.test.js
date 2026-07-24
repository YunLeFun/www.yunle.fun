import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { REWARD_CLAIM_OPS_DEPLOYMENT_PLAN } from '../scripts/deploy-reward-claim-ops.mjs'

const execFileAsync = promisify(execFile)

describe('权益领取定时函数部署门禁', () => {
  it('声明私有一分钟触发器与所需独立密钥', () => {
    expect(REWARD_CLAIM_OPS_DEPLOYMENT_PLAN).toMatchObject({
      function: 'reward-claim-ops',
      trigger: { config: '0 * * * * * *' },
    })
    expect(REWARD_CLAIM_OPS_DEPLOYMENT_PLAN.requiredEnvironmentVariables)
      .toEqual(expect.arrayContaining([
        'ACCOUNT_API_INTERNAL_TOKEN',
        'REWARD_CLAIM_LINK_HASH_KEY',
        'REWARD_CLAIM_RATE_TICKET_SECRET',
        'REWARD_CLAIM_OPS_WEBHOOK_URL',
      ]))
  })

  it('默认无网络、零写入', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      'scripts/deploy-reward-claim-ops.mjs',
    ], { cwd: process.cwd(), env: {} })
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'dry-run',
      networkRequests: 0,
      writes: 0,
    })
  })

  it('未精确确认环境时拒绝部署', async () => {
    await expect(execFileAsync(process.execPath, [
      'scripts/deploy-reward-claim-ops.mjs',
      '--apply',
      '--confirm-env=wrong',
    ], {
      cwd: process.cwd(),
      env: { ...process.env, NUXT_CLOUDBASE_ENV_ID: 'production-env' },
    })).rejects.toMatchObject({
      stderr: expect.stringContaining('--confirm-env'),
    })
  })
})
