import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('page SEO titles', () => {
  it.each([
    ['login.vue', '登录 / 注册'],
    ['signup.vue', '注册'],
  ])('lets the global title template append the site name for %s', (file, title) => {
    const source = readFileSync(new URL(`../../app/pages/${file}`, import.meta.url), 'utf8')

    expect(source).toContain(`title: '${title}'`)
    expect(source).not.toContain(`title: '${title} - 云乐坊'`)
  })

  it('explains the staged auto-registration policy on the login page', () => {
    const source = readFileSync(new URL('../../app/pages/login.vue', import.meta.url), 'utf8')

    expect(source).toContain('仅支持中国大陆手机号，首次验证自动创建账号')
    expect(source).toContain('邮箱登录需先在账号设置中完成绑定')
    expect(source).toContain('手机号或 GitHub 首次验证后自动创建账号')
  })
})
