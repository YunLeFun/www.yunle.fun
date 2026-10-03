import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('glass button styles', () => {
  it('draws the shared button stroke without changing the button box size', async () => {
    const stylesheet = await readFile(
      new URL('../../app/assets/css/main.css', import.meta.url),
      'utf8',
    )
    const rule = stylesheet.match(/\.ylf-glass-btn:is\(\[data-slot='base'\], \[data-slot='button'\]\)\s*\{([^}]*)\}/)?.[1]

    expect(rule).toBeDefined()
    expect(rule).toContain('border: 0')
    expect(rule).toMatch(/box-shadow:\s*inset 0 0 0 1px/)
    expect(rule).not.toMatch(/border:\s*1px/)
  })
})
