import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

// CloudBase SDK（~800KB）与 MDC 解析器（~550KB）一旦被入口或公开页面静态引用，
// 就会进入每个匿名访客的首屏 JS。这些模块只能通过 `await import()` 按需加载。
describe('client bundle boundaries', () => {
  it('keeps the CloudBase SDK out of the entry chunk', async () => {
    const plugin = await source('app/plugins/acquisition.client.ts')

    expect(plugin).not.toMatch(/^import .* from ['"]~\/composables\/(?:useCloudbase|auth\/useAcquisition)['"]/m)
    expect(plugin).toContain('import(\'~/composables/useCloudbase\')')
    expect(plugin).toContain('import(\'~/composables/auth/useAcquisition\')')
  })

  it('lets the public app atlas render without the CloudBase SDK', async () => {
    const page = await source('app/pages/explore.vue')

    expect(page).not.toMatch(/^import .* from ['"]~\/composables\/auth\//m)
    expect(page).not.toContain('useApps()')
    expect(page).toContain('import(\'~/composables/auth/useAuthSession\')')
  })

  it('loads the Markdown parser and raw sources only when a payload is missing', async () => {
    const content = await source('app/utils/content.ts')

    expect(content).not.toMatch(/^import \{[^}]*\} from ['"]@nuxtjs\/mdc\/runtime['"]/m)
    expect(content).toContain('import(\'@nuxtjs/mdc/runtime\')')
    expect(content).not.toContain('eager: true')
  })
})
