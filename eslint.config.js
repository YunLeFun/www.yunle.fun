// @ts-check
import antfu from '@antfu/eslint-config'
import nuxt from './.nuxt/eslint.config.mjs'

export default antfu(
  {
    unocss: false,
    formatters: true,
    pnpm: true,
    ignores: [
      '.codebuddy/**',
      'rules/**',
    ],
  },
)
  .append(nuxt())
  .overrideRules({
    'pnpm/yaml-no-unused-catalog-item': 'off',
    'vue/v-on-event-hyphenation': 'off',
  })
