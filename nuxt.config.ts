import process from 'node:process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/content',
    '@nuxt/ui',
    '@nuxt/image',
    '@vueuse/nuxt',
    '@nuxtjs/i18n',
  ],

  // 启用 SSR，公开页面享受服务端渲染带来的 SEO 和首屏性能提升
  ssr: true,

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
    },
  },

  routeRules: {
    '/docs': { redirect: '/docs/getting-started', prerender: false },
    // 需要 CloudBase Auth 的页面禁用 SSR
    '/login': { ssr: false },
    '/signup': { ssr: false },
    '/profile': { ssr: false },
    '/settings': { ssr: false },
    '/apps/**': { ssr: false },
    '/auth/**': { ssr: false },
    // 静态内容页预渲染
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/blog/**': { prerender: true },
    '/changelog/**': { prerender: true },
    '/docs/**': { prerender: true },
  },

  experimental: {
    payloadExtraction: true,
  },

  compatibilityDate: 'latest',

  nitro: {
    prerender: {
      routes: ['/'],
      crawlLinks: true,
    },
  },

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
    // SSR 构建时将 CloudBase SDK 标记为外部依赖，避免在 Node 中打包浏览器 SDK
    ssr: {
      external: ['@cloudbase/js-sdk'],
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

  i18n: {
    locales: [
      {
        code: 'zh-CN',
        iso: 'zh-CN',
        name: '简体中文',
        file: 'zh-CN.json',
      },
      {
        code: 'en',
        iso: 'en-US',
        name: 'English',
        file: 'en.json',
      },
    ],
    defaultLocale: 'zh-CN',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
      redirectOn: 'root',
    },
    langDir: 'locales',
  },
})
