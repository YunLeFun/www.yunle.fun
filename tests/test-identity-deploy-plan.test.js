import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

import { TEST_IDENTITY_FUNCTIONS } from '../scripts/deploy-test-identity-functions.mjs'

const execFileAsync = promisify(execFile)

describe('测试身份云函数部署计划', () => {
  it('固定按依赖顺序发布三个函数', () => {
    expect(TEST_IDENTITY_FUNCTIONS).toEqual([
      'account-api',
      'sso-ticket',
      'test-identity-sweeper',
    ])
  })

  it('默认只输出零网络、零写入 dry-run', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      'scripts/deploy-test-identity-functions.mjs',
    ], {
      cwd: process.cwd(),
      env: {},
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      mode: 'dry-run',
      envId: 'yunlefun-8g7ybcxc7345c490',
      functions: TEST_IDENTITY_FUNCTIONS,
      networkRequests: 0,
      writes: 0,
    })
  })

  it('执行模式要求精确确认环境 ID', async () => {
    await expect(execFileAsync(process.execPath, [
      'scripts/deploy-test-identity-functions.mjs',
      '--apply',
      '--confirm-env=wrong-environment',
    ], {
      cwd: process.cwd(),
      env: {},
    })).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('must exactly match'),
    })
  })
})
