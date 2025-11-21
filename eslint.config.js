// @ts-check
import antfu from '@antfu/eslint-config'
import nuxt from './.nuxt/eslint.config.mjs'

export default antfu(
  {
    unocss: false,
    formatters: true,
    pnpm: true,
  },
)
  .append(nuxt())
