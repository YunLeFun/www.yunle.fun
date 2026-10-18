import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { collectVueDisplayText, displayFontCharacters, uniqueCharacters } from '../../scripts/lib/display-font-text.mjs'
import { readWoff2CodePoints } from '../../scripts/lib/woff2-cmap.mjs'

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

  it('collects every display-font string without undeclared dynamic text', () => {
    const { errors, sources } = displayFontCharacters()
    expect(errors).toEqual([])
    expect([...sources.keys()]).toEqual(expect.arrayContaining([
      'app/pages/index.vue',
      'app/pages/pricing.vue',
      'app/components/MemberPass.vue',
    ]))
  })

  it('has a glyph for every character rendered in the display font', () => {
    const covered = readWoff2CodePoints(readFileSync(fontUrl))
    const { characters } = displayFontCharacters()
    const missing = [...characters].filter(char => !covered.has(char.codePointAt(0)))
    // 缺字时运行 `node scripts/subset-display-font.mjs --source <ZCOOLXiaoWei-Regular.ttf>` 重新生成子集。
    expect(missing.join('')).toBe('')
  })
})

describe('display font text scanner', () => {
  const file = 'app/components/Fixture.vue'

  it('collects static text, literals and statically known consts', () => {
    const { text, errors } = collectVueDisplayText(file, `
<script setup lang="ts">
const props = defineProps<{ on: boolean }>()
const headline = '晴空'
const label = computed(() => (props.on ? '开' : '关'))
</script>
<template>
  <h1 class="ylf-display mt-5">你好<span>{{ headline }}</span>{{ on ? '在' : '无' }}{{ label }}</h1>
  <p>不收集</p>
</template>`)
    expect(errors).toEqual([])
    expect(uniqueCharacters(text)).toBe(uniqueCharacters('你好晴空在无开关'))
  })

  it('rejects dynamic text that is not declared', () => {
    const { errors } = collectVueDisplayText(file, `
<template>
  <h3 class="ylf-dreamy-display">{{ user.name }}</h3>
</template>`)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('`user.name`')
  })

  it('accepts declared dynamic text', () => {
    const { text, errors } = collectVueDisplayText(file, `
<template>
  <span class="ylf-dreamy-display">{{ count ?? '—' }}</span>
</template>`, { [`${file}::count`]: '0123456789' })
    expect(errors).toEqual([])
    expect(uniqueCharacters(text)).toBe('0123456789—')
  })

  it('rejects display classes applied through bindings', () => {
    const { errors } = collectVueDisplayText(file, `
<template>
  <h1 :class="big ? 'ylf-display' : ''">{{ title }}</h1>
</template>`)
    expect(errors.join('\n')).toContain('静态 class')
  })

  it('collects AppPageHero titles at the call site, preferring the title slot', () => {
    const { text, errors } = collectVueDisplayText(file, `
<template>
  <AppPageHero title="下载" :description="desc" />
  <AppPageHero :title="page.title">
    <template #title>云乐坊 <span>生态</span></template>
  </AppPageHero>
</template>`)
    expect(errors).toEqual([])
    expect(uniqueCharacters(text)).toBe(uniqueCharacters('下载云乐坊生态'))
  })
})
