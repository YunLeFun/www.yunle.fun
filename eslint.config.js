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
  // CloudBase 云函数是独立部署单元，各自 npm install，不能用 pnpm 的 catalog: 协议，
  // 否则云端安装依赖会失败（ResourceNotFound.Package）。这里关闭对它们的 catalog 强制。
  .append({
    files: ['functions/**/package.json'],
    rules: {
      'pnpm/json-enforce-catalog': 'off',
      'pnpm/json-valid-catalog': 'off',
    },
  })
