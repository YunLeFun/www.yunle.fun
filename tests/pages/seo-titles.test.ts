import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('page SEO titles', () => {
  it.each([
    ['login.vue', '登录'],
    ['signup.vue', '注册'],
  ])('lets the global title template append the site name for %s', (file, title) => {
    const source = readFileSync(new URL(`../../app/pages/${file}`, import.meta.url), 'utf8')

    expect(source).toContain(`title: '${title}'`)
    expect(source).not.toContain(`title: '${title} - 云乐坊'`)
  })
})
