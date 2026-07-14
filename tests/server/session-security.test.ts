import { describe, expect, it, vi } from 'vitest'
import { disableSessionResponseCaching } from '../../server/utils/session-security'

describe('disableSessionResponseCaching', () => {
  it('prevents session responses from entering browser or CDN caches', () => {
    const setHeader = vi.fn()
    const event = {
      node: {
        res: { setHeader },
      },
    }

    disableSessionResponseCaching(event as never)

    expect(setHeader).toHaveBeenCalledWith('cache-control', 'private, no-store')
    expect(setHeader).toHaveBeenCalledWith('pragma', 'no-cache')
  })
})
