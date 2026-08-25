import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  new URL('../../app/assets/css/main.css', import.meta.url),
  'utf8',
)
const fontUrl = new URL('../../public/fonts/zcool-xiaowei-display.woff2', import.meta.url)

describe('brand display font', () => {
  it('self-hosts ZCOOL XiaoWei for dreamy display headings', () => {
    expect(css).toContain('font-family: \'ZCOOL XiaoWei\'')
    expect(css).toContain('font-display: swap')
    expect(css).toContain('src: url(\'/fonts/zcool-xiaowei-display.woff2\') format(\'woff2\')')
    expect(css).toContain('--ylf-font-dreamy: \'ZCOOL XiaoWei\'')
    expect(existsSync(fontUrl)).toBe(true)
  })

  it('keeps the display subset within the initial-page font budget', () => {
    expect(statSync(fontUrl).size).toBeLessThan(100 * 1024)
  })
})
