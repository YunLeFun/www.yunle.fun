import { describe, expect, it, vi } from 'vitest'

import {
  authenticateCloudBaseCli,
  isKnownCloudBaseLoginTailFailure,
} from '../scripts/authenticate-cloudbase-ci.mjs'

const env = {
  CLOUDBASE_API_KEY: 'development-api-key',
  CLOUDBASE_ENV_ID: 'yunlefun-dev-0ge03bdod37093d1',
}

describe('cloudBase CI authentication', () => {
  it('recognizes the 3.6.4 post-login global credential failure', () => {
    expect(isKnownCloudBaseLoginTailFailure([
      '✔ login succeeded.',
      'CloudBaseError: No valid identity information, please use cloudbase login to login',
    ].join('\n'))).toBe(true)
    expect(isKnownCloudBaseLoginTailFailure('CloudBase API Key validation failed')).toBe(false)
  })

  it('accepts the known tail failure only after a read-only credential check succeeds', () => {
    const run = vi.fn()
      .mockReturnValueOnce({
        status: 1,
        stdout: '✔ login succeeded.',
        stderr: 'CloudBaseError: No valid identity information',
      })
      .mockReturnValueOnce({ status: 0, stdout: '{"functions":[]}', stderr: '' })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    authenticateCloudBaseCli({ env, logger, run })

    expect(run).toHaveBeenNthCalledWith(1, [
      'login',
      '--cloudbase-api-key',
      env.CLOUDBASE_API_KEY,
      '-e',
      env.CLOUDBASE_ENV_ID,
      '--json',
    ], env)
    expect(run).toHaveBeenNthCalledWith(2, [
      'fn',
      'list',
      '-e',
      env.CLOUDBASE_ENV_ID,
      '--json',
    ], env)
    expect(logger.warn).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(env.CLOUDBASE_ENV_ID))
  })

  it('rejects an unexpected login failure without attempting verification', () => {
    const run = vi.fn().mockReturnValue({
      status: 1,
      stdout: '',
      stderr: `invalid ${env.CLOUDBASE_API_KEY}`,
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }

    expect(() => authenticateCloudBaseCli({ env, logger, run })).toThrow('CloudBase CLI 登录失败')
    expect(run).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(expect.not.stringContaining(env.CLOUDBASE_API_KEY))
  })

  it('rejects the known tail failure when the project credential is unusable', () => {
    const run = vi.fn()
      .mockReturnValueOnce({
        status: 1,
        stdout: '✔ login succeeded.',
        stderr: 'CloudBaseError: No valid identity information',
      })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'permission denied' })

    expect(() => authenticateCloudBaseCli({
      env,
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
      run,
    })).toThrow('CloudBase 项目凭据验证失败')
  })
})
