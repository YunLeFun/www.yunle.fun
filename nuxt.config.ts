import process from 'node:process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/content',
    '@nuxt/ui',
    '@nuxt/image',
    '@vueuse/nuxt',
    // '@nuxtjs/i18n', // 暂时禁用国际化，未来重新启用
  ],

  // 关闭 SSR，作为纯静态站点托管
  ssr: false,

  devtools: {
    enabled: true,
  },

  // 预连接外部域名加速首屏
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://tcb-api.tencentcloudapi.com' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:5173',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      githubClientId: process.env.NUXT_PUBLIC_GITHUB_CLIENT_ID || '',
      cloudbaseEnvId: process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID || '',
      cloudbaseRegion: process.env.NUXT_PUBLIC_CLOUDBASE_REGION || 'ap-shanghai',
      cloudbaseAccessKey: process.env.NUXT_PUBLIC_CLOUDBASE_ACCESS_KEY || '',
      enableH5Pay: process.env.NUXT_PUBLIC_ENABLE_H5_PAY === 'true',
    },
  },

  routeRules: {
    '/docs': { redirect: '/docs/getting-started' },
  },

  experimental: {
    payloadExtraction: true,
  },

  compatibilityDate: 'latest',

  nitro: {},

  vite: {
    server: {
      allowedHosts: true,
    },
    build: {
      rollupOptions: {
        output: {
          // 将大型依赖拆分为独立 chunk
          manualChunks(id) {
            if (id.includes('@cloudbase'))
              return 'cloudbase'
          },
        },
      },
    },
  },

  eslint: {
    config: {
      standalone: false,
      nuxt: {
        sortConfigKeys: true,
      },
    },
  },

  // i18n 配置暂时禁用，未来重新启用时取消注释
  // i18n: {
  //   locales: [
  //     { code: 'zh-CN', iso: 'zh-CN', name: '简体中文', file: 'zh-CN.json' },
  //     { code: 'en', iso: 'en-US', name: 'English', file: 'en.json' },
  //   ],
  //   defaultLocale: 'zh-CN',
  //   strategy: 'no_prefix',
  //   detectBrowserLanguage: { useCookie: true, redirectOn: 'root' },
  //   langDir: 'locales',
  // },
})
