import { IconUsageScanner } from '@nuxt/icon/utils'
import { describe, expect, it } from 'vitest'
import { iconRegistrationCode, scanIcons } from '../../modules/icon-colocation'

const scanner = new IconUsageScanner(true)

// 图标数据随引用它的模块打包（modules/icon-colocation.ts），全局 client bundle 只留共享图标。
describe('icon colocation', () => {
  it('finds icons the same way as the Nuxt Icon client bundle scan', () => {
    const source = `
      <Icon name="i-lucide-wallet" />
      const items = [{ icon: 'i-ri-github-fill' }, { icon: 'lucide:coins' }]
    `

    expect(scanIcons(scanner, source, new Set())).toEqual(['lucide:coins', 'lucide:wallet', 'ri:github-fill'])
  })

  it('skips icons already registered by the global client bundle', () => {
    expect(scanIcons(scanner, '<Icon name="i-lucide-sun" /><Icon name="i-lucide-moon-star" />', new Set(['lucide:sun'])))
      .toEqual(['lucide:moon-star'])
  })

  it('registers icon data inline so no side-effect-only import can be tree-shaken away', () => {
    const code = iconRegistrationCode([['lucide:sun', { body: '<circle/>', width: 24, height: 24 }]])

    expect(code).toContain('from "virtual:ylf-icon-register"')
    expect(code).toContain('__ylfAddIcon("lucide:sun", {"body":"<circle/>","width":24,"height":24});')
    expect(code).not.toMatch(/^import "/m)
    expect(iconRegistrationCode([])).toBe('')
  })
})
