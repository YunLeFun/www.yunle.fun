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
    const shapeRule = source.match(/\.sso-account-cloud__shape\s*\{([^}]*)\}/)?.[1]
    const interactionRules = [...source.matchAll(/[^{}]*(?:hover|focus-visible)[^{}]*\{([^}]*)\}/g)]

    expect(rootRule).toBeDefined()
    expect(rootRule).not.toMatch(/transition:[^;]*filter/)
    expect(shapeRule).toBeDefined()
    expect(shapeRule).not.toMatch(/transition:[^;]*filter/)
    for (const [, rule] of interactionRules)
      expect(rule).not.toMatch(/\bfilter\s*:/)
  })

  it('keeps application nodes stable while their interaction indicators appear', async () => {
    const source = await readComponent('apps/SsoAppCloud.vue')
    const rootRule = source.match(/\.sso-app-node\s*\{([^}]*)\}/)?.[1]
    const linkRule = source.match(/\.sso-app-node__link\s*\{([^}]*)\}/)?.[1]
    const interactionRules = [...source.matchAll(/[^{}]*(?:hover|focus-within|sso-app-node--active)[^{}]*\{([^}]*)\}/g)]

    expect(source).not.toContain('sso-app-cloud__shape')
    expect(rootRule).toBeDefined()
    expect(linkRule).toBeDefined()
    expect(linkRule).toMatch(/padding:/)
    expect(linkRule).toMatch(/border-radius:/)
    expect(rootRule).not.toMatch(/^\s*filter\s*:/m)
    expect(interactionRules.length).toBeGreaterThan(0)
    for (const [, rule] of interactionRules)
      expect(rule).not.toMatch(/\b(?:filter|transform|width|height|padding)\s*:/)
  })

  it('renders the sky scene once and defers the offscreen cloud map', async () => {
    const [sceneSource, mapSource, homePageSource, homeShowcaseSource, heroSource, authLayoutSource] = await Promise.all([
      readComponent('SkyScene.vue'),
      readComponent('apps/AppSsoCloudMap.vue'),
      readApp('pages/index.vue'),
      readComponent('HomeAppShowcase.vue'),
      readComponent('SkyHero.vue'),
      readApp('layouts/auth.vue'),
    ])

    expect(sceneSource).not.toContain('hydrationVersion')
    expect(sceneSource).toContain('var(--ylf-sky-scene-background)')
    expect(sceneSource).toContain(':global(.dark)')
    expect(homeShowcaseSource).toContain('useIntersectionObserver')
    expect(homeShowcaseSource).toContain('defineAsyncComponent')
    expect(homeShowcaseSource).toContain('rootMargin: \'0px 0px -20% 0px\'')
    expect(mapSource).not.toContain('app-sso-cloud-map--paused')
    for (const consumer of [mapSource, homePageSource, heroSource, authLayoutSource])
      expect(consumer).not.toContain(':theme="skyTheme"')
  })
})
