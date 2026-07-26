import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readComponent(path: string) {
  return readFile(new URL(`../../app/components/${path}`, import.meta.url), 'utf8')
}

async function readApp(path: string) {
  return readFile(new URL(`../../app/${path}`, import.meta.url), 'utf8')
}

describe('sso cloud visual effects', () => {
  it('keeps the account cloud shadow stable while hovering', async () => {
    const source = await readComponent('apps/SsoAccountCloud.vue')
    const rootRule = source.match(/\.sso-account-cloud\s*\{([^}]*)\}/)?.[1]
    const interactionRule = source.match(
      /\.sso-account-cloud:hover,\s*\.sso-account-cloud:focus-visible\s*\{([^}]*)\}/,
    )?.[1]

    expect(rootRule).toBeDefined()
    expect(rootRule).not.toMatch(/transition:[^;]*filter/)
    expect(interactionRule).toBeDefined()
    expect(interactionRule).not.toMatch(/\bfilter\s*:/)
  })

  it('renders applications as stable card nodes instead of cloud silhouettes', async () => {
    const source = await readComponent('apps/SsoAppCloud.vue')
    const rootRule = source.match(/\.sso-app-node\s*\{([^}]*)\}/)?.[1]
    const interactionRule = source.match(
      /\.sso-app-node:hover,\s*\.sso-app-node:focus-within,\s*\.sso-app-node--active\s*\{([^}]*)\}/,
    )?.[1]

    expect(source).not.toContain('sso-app-cloud__shape')
    expect(rootRule).toBeDefined()
    expect(rootRule).toMatch(/padding:/)
    expect(rootRule).toMatch(/border-radius:/)
    expect(rootRule).not.toMatch(/^\s*filter\s*:/m)
    expect(interactionRule).toBeDefined()
    expect(interactionRule).not.toMatch(/\bfilter\s*:/)
  })

  it('renders the sky scene once without offscreen animation pausing', async () => {
    const [sceneSource, mapSource, homeSource, heroSource, authLayoutSource] = await Promise.all([
      readComponent('SkyScene.vue'),
      readComponent('apps/AppSsoCloudMap.vue'),
      readApp('pages/index.vue'),
      readComponent('SkyHero.vue'),
      readApp('layouts/auth.vue'),
    ])

    expect(sceneSource).not.toContain('hydrationVersion')
    expect(sceneSource).toContain('var(--ylf-sky-scene-background)')
    expect(sceneSource).toContain(':global(.dark)')
    expect(mapSource).not.toContain('useIntersectionObserver')
    expect(mapSource).not.toContain('app-sso-cloud-map--paused')
    for (const consumer of [mapSource, homeSource, heroSource, authLayoutSource])
      expect(consumer).not.toContain(':theme="skyTheme"')
  })
})
