// 用 @nuxt/test-utils 的 defineVitestConfig 注册 'nuxt' 测试环境（组件测试用），
// 默认环境仍为 node（云函数 / util 等纯逻辑测试不受影响）；
// 需要 Nuxt 上下文的测试在文件顶部加 `// @vitest-environment nuxt` 单独选入。
import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    include: ['tests/**/*.test.{js,ts,mjs}'],
    environment: 'node',
    globals: false,
    // Nuxt 组件环境需要各自初始化应用；限制 worker 避免大量并发转换抢占 CPU 后触发假超时。
    maxWorkers: 4,
    // Nuxt 测试环境会在文件级 beforeAll 中完成应用初始化；全量并行转换时可能超过默认 10s。
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: [
        'cloudfunctions/wxpay-order/lib/**/*.js',
        'app/composables/useMembership.ts',
      ],
      reporter: ['text', 'html'],
    },
    // 云函数库是 CommonJS，但被 vitest 当 ESM 入口加载时通过 require 调用，
    // 这里显式声明 server.deps.inline 以避免被 vite 二次转译造成 require 失效
    server: {
      deps: {
        inline: ['@cloudbase/node-sdk'],
      },
    },
  },
})
