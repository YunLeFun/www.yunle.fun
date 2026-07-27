import { describe, expect, it } from 'vitest'
import { getDocPage, getDocSearchIndex } from '../../app/utils/content'

describe('help search index', () => {
  it('indexes help titles and body text without developer hero metadata', async () => {
    const index = await getDocSearchIndex()
    const gettingStarted = index.find(item => item.path === '/docs/getting-started')

    expect(gettingStarted).toMatchObject({
      title: '开始使用',
      path: '/docs/getting-started',
    })
    expect(gettingStarted?.searchText).toContain('创建账号')
    expect(gettingStarted?.searchText).not.toContain('titleaccent')
  })

  it('keeps the contact page support routes in globally renderable MDC components', async () => {
    const page = await getDocPage('/docs/contact')
    const body = JSON.stringify(page?.body)

    expect(body).toContain('ylf-support-entry')
    expect(body).toContain('ylf-private-support-actions')
    expect(body).toContain('ylf-social-icons')
  })
})
