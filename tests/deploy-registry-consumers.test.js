import { describe, expect, it, vi } from 'vitest'

import {
  deployRegistryConsumers,
  REGISTRY_CONSUMER_ENVIRONMENTS,
} from '../scripts/deploy-registry-consumers.mjs'

describe('registry consumer deployment', () => {
  it('updates code only for every development authorization-core consumer', () => {
    const build = vi.fn(names => names.map(name => `/artifacts/${name}`))
    const run = vi.fn(() => ({ status: 0 }))

    deployRegistryConsumers('development', { build, env: {}, run })

    expect(REGISTRY_CONSUMER_ENVIRONMENTS.development.functions).toEqual([
      'sso-registry-admin',
      'sso-ticket',
    ])
    expect(build).toHaveBeenCalledWith([
      'sso-registry-admin',
      'sso-ticket',
    ])
    expect(run).toHaveBeenCalledTimes(2)
    for (const [index, functionName] of REGISTRY_CONSUMER_ENVIRONMENTS.development.functions.entries()) {
      expect(run.mock.calls[index][1]).toEqual(expect.arrayContaining([
        'fn',
        'code',
        'update',
        functionName,
        '--dir',
        `/artifacts/${functionName}`,
      ]))
      expect(run.mock.calls[index][1]).not.toContain('deploy')
      expect(run.mock.calls[index][1]).not.toContain('config')
    }
  })

  it('keeps production consumers complete without performing a deployment', () => {
    expect(REGISTRY_CONSUMER_ENVIRONMENTS.production.functions).toEqual([
      'desktop-auth',
      'sso-registry-admin',
      'sso-ticket',
    ])
  })

  it('blocks production builds and code updates when desktop indexes are incompatible', () => {
    const build = vi.fn()
    const run = vi.fn()
    const checkDesktopIndexes = vi.fn(() => {
      throw new Error('indexes incompatible')
    })
    expect(() => deployRegistryConsumers('production', { build, run, env: {}, checkDesktopIndexes }))
      .toThrow('indexes incompatible')
    expect(checkDesktopIndexes).toHaveBeenCalledWith(REGISTRY_CONSUMER_ENVIRONMENTS.production.envId, { run, env: {} })
    expect(build).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
})
