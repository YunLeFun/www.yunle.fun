import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { CODE_AUDIT_RETENTION_MS, runSweep, sweepCollection } = require('../../cloudfunctions/sso-security-sweeper/index.js')

function fakeDatabase(recordsByCollection) {
  const removed = []
  const database = {
    command: { lte: value => ({ lte: value }) },
    collection(name) {
      return {
        where({ expiresAt }) {
          return {
            orderBy() {
              return {
                limit(limit) {
                  return {
                    async get() {
                      return { data: (recordsByCollection[name] || []).filter(item => item.expiresAt <= expiresAt.lte).slice(0, limit) }
                    },
                  }
                },
              }
            },
          }
        },
        doc(id) {
          return {
            async remove() {
              removed.push([name, id])
              recordsByCollection[name] = (recordsByCollection[name] || []).filter(item => item._id !== id)
              return { deleted: 1 }
            },
          }
        },
      }
    },
  }
  return { database, removed }
}

describe('sSO security timer sweep', () => {
  it('retains recent codes, removes old codes and expired rate-limit windows', async () => {
    const now = 2_000_000_000_000
    const oldCode = 'a'.repeat(64)
    const recentCode = 'b'.repeat(64)
    const expiredLimit = 'c'.repeat(64)
    const activeLimit = 'd'.repeat(64)
    const fixture = fakeDatabase({
      sso_login_codes: [
        { _id: oldCode, expiresAt: now - CODE_AUDIT_RETENTION_MS - 1 },
        { _id: recentCode, expiresAt: now - 1 },
      ],
      sso_security_limits: [
        { _id: expiredLimit, expiresAt: now },
        { _id: activeLimit, expiresAt: now + 1 },
      ],
    })

    await expect(runSweep(fixture.database, now)).resolves.toEqual({
      ok: true,
      codes: { scanned: 1, removed: 1 },
      rateLimits: { scanned: 1, removed: 1 },
    })
    expect(fixture.removed).toEqual([
      ['sso_login_codes', oldCode],
      ['sso_security_limits', expiredLimit],
    ])
  })

  it('skips malformed document ids instead of deleting arbitrary records', async () => {
    const fixture = fakeDatabase({ test: [{ _id: '../unsafe', expiresAt: 1 }] })
    await expect(sweepCollection(fixture.database, 'test', 1, { batchSize: 100, maxBatches: 1 }))
      .resolves
      .toEqual({ scanned: 1, removed: 0 })
    expect(fixture.removed).toEqual([])
  })
})
