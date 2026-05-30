import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,ts,mjs}'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: [
        'functions/wxpay-order/lib/**/*.js',
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
