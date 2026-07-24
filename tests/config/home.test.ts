import { describe, expect, it } from 'vitest'
import { homePage } from '../../app/config/home'

describe('homepage content', () => {
  it('keeps application discovery as the primary journey', () => {
    expect(homePage.hero.links[0]).toMatchObject({
      label: '浏览应用',
      to: '/explore',
    })
    expect(homePage.hero.links[1]).toMatchObject({
      label: '创建账号',
      to: '/signup',
    })
  })

  it('does not advertise unavailable developer or fabricated social proof', () => {
    const content = JSON.stringify(homePage)

    expect(content).not.toMatch(/开发者平台|部署面板|自助上架|社区评分|用户怎么说|10\+/)
    expect(homePage).not.toHaveProperty('testimonials')
    expect(homePage).not.toHaveProperty('sections')
  })
})
