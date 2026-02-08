import process from 'node:process'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/content',
    '@nuxt/ui',
    '@nuxt/icon',
    '@nuxt/image',
    '@vueuse/nuxt',
    // 'nuxt-og-image', // Disabled: requires SSR to be enabled
    '@nuxtjs/i18n',
  ],
  ssr: false,

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:5173',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      githubClientId: process.env.NUXT_PUBLIC_GITHUB_CLIENT_ID || '',
    },
  },

  routeRules: {
    '/docs': { redirect: '/docs/getting-started', prerender: false },
    '/sw.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
    '/workbox-*.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
  },

  compatibilityDate: 'latest',

  nitro: {
    prerender: {
      routes: [
        '/',
      ],
      crawlLinks: true,
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
    strategy: 'no_prefix', // 不在 URL 中添加语言前缀
    detectBrowserLanguage: {
      useCookie: true,
      redirectOn: 'root',
    },
    langDir: 'locales',
  },
})
