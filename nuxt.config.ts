import type { Plugin } from 'vite'
import process from 'node:process'
import yaml from '@rollup/plugin-yaml'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    // Markdown 渲染（替代 @nuxt/content，见 docs/nuxt-content-removal.md）
    '@nuxtjs/mdc',
    '@nuxt/ui',
    '@nuxt/image',
    '@vueuse/nuxt',
    // 双层会话迁移：用 nuxt-auth-utils 封 sealed httpOnly cookie 作持久会话（见 docs/cookie-session-migration.md）
    'nuxt-auth-utils',
    // '@nuxtjs/i18n', // 暂时禁用国际化，未来重新启用
  ],

  // Hybrid 渲染：默认 SSR。公开内容页（首页/文档/博客/定价/更新日志/开发者）走预渲染拿 SEO 与首屏；
  // 账号 / 交互 / OAuth / 数据驱动页靠 CloudBase 客户端登录态，走 client-only。两类策略都在 routeRules 声明。
  ssr: true,

  devtools: {
    enabled: process.env.NODE_ENV === 'development',
  },

  // 预连接外部域名加速首屏
  app: {
    head: {
      link: [
        // 首屏很快会发起 auth 请求，主 API 域名用 preconnect 提前完成 DNS+TCP+TLS
        { rel: 'preconnect', href: 'https://tcb-api.tencentcloudapi.com', crossorigin: '' },
        // gateway 域名按需调用，dns-prefetch 解析即可
        { rel: 'dns-prefetch', href: `https://${process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID || 'yunlefun-8g7ybcxc7345c490'}.api.tcloudbasegateway.com` },
        // 梦幻晴空品牌字体（站酷小薇 ZCOOL XiaoWei + Baloo 2），走国内镜像 loli.net；
        // 镜像 CSS 已按 unicode-range 切片，浏览器只下载页面实际用到的字形分片；
        // 用 preload→onload 切回 stylesheet，避免字体 CSS 往返阻塞首屏渲染（display=swap 期间用系统字体兜底）。
        { rel: 'preconnect', href: 'https://fonts.loli.net' },
        { rel: 'preconnect', href: 'https://gstatic.loli.net', crossorigin: '' },
        {
          rel: 'preload',
          as: 'style',
          href: 'https://fonts.loli.net/css2?family=Baloo+2:wght@500;600;700&family=ZCOOL+XiaoWei&display=swap',
          onload: 'this.onload=null;this.rel=\'stylesheet\'',
        },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    classSuffix: '',
    fallback: 'light',
    preference: 'light',
  },

  ui: {
    fonts: false,
  },

  runtimeConfig: {
    // CloudBase account-api 的 HTTP 访问服务地址（server 端 SSR 代理 getProfile 用；
    // 未配置则 /u 主页退化为客户端渲染，不影响功能仅影响 SEO）
    accountApiHttpUrl: process.env.NUXT_ACCOUNT_API_HTTP_URL || '',
    // nuxt-auth-utils sealed httpOnly cookie 会话（见 docs/cookie-session-migration.md · Phase 5）。
    // password 由 NUXT_SESSION_PASSWORD env 注入（≥32 字符）；以下显式收口 cookie flags。
    session: {
      name: 'ylf_session',
      maxAge: 60 * 60 * 24 * 30, // 30 天持久会话（cookie 过期即需重新登录）
      cookie: {
        // httpOnly / secure(prod) / path='/' 为 nuxt-auth-utils 默认；
        // SameSite=Lax 缓解 CSRF，且兼容 OAuth 跳回（Strict 会丢首跳 cookie）。
        sameSite: 'lax',
      },
    },
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:5173',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      githubClientId: process.env.NUXT_PUBLIC_GITHUB_CLIENT_ID || '',
      cloudbaseEnvId: process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID || 'yunlefun-8g7ybcxc7345c490',
      cloudbaseRegion: process.env.NUXT_PUBLIC_CLOUDBASE_REGION || 'ap-shanghai',
      cloudbaseAccessKey: process.env.NUXT_PUBLIC_CLOUDBASE_ACCESS_KEY || '',
      // 双层会话总开关：true 时启用 cookie→ticket 启动恢复（httpOnly cookie 作 SSR 可读会话真值）。
      // 默认 false = 现状。prod 待铸票端点就绪后在 EdgeOne env 置 true。
      cookieSession: process.env.NUXT_PUBLIC_COOKIE_SESSION === 'true',
      // 内存化 token opt-in（需 cookieSession=true）：token 只存内存、不落 localStorage（XSS at-rest 硬化）。
      // 默认 false——启用前需先做「会话就绪前不发鉴权请求」门控，否则启动竞态会 403。见 docs/cookie-session-migration.md。
      cookieSessionMemory: process.env.NUXT_PUBLIC_COOKIE_SESSION_MEMORY === 'true',
      ssoAllowedTargetOrigins: process.env.NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS || 'https://*.yunle.fun,https://*.yunyoujun.cn,https://*.elpsy.cn',
      enableH5Pay: process.env.NUXT_PUBLIC_ENABLE_H5_PAY === 'true',
    },
  },

  routeRules: {
    '/docs': { redirect: '/docs/getting-started' },
    // 开发者文档已迁至 docs.yunle.fun（见 docs/nuxt-content-removal.md）
    '/docs/developer': { redirect: 'https://docs.yunle.fun' },
    '/docs/developer/cloudbase-codebuddy': { redirect: 'https://docs.yunle.fun/guide/cloudbase-codebuddy' },
    '/docs/getting-started/writing-guide': { redirect: 'https://docs.yunle.fun/guide/configuration' },

    // ── 渲染策略（hybrid）──
    // 公开内容页：构建期预渲染（静态 HTML），SEO + 首屏最佳。
    // 注：nuxt build（node-server 预设）的预渲染基线内存高于 nuxt generate，会撞 EdgeOne 构建机默认 ~2GB Node 堆；
    // 已在 package.json build 脚本调高 --max-old-space-size + 下方 crawlLinks:false 限定路由集来避免 OOM。
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/blog': { prerender: true },
    '/blog/**': { prerender: true },
    '/docs/**': { prerender: true },
    '/changelog': { prerender: true },
    '/developer': { prerender: true },
    // 账号 / 交互 / OAuth / 数据驱动页：纯客户端渲染。
    // CloudBase 登录态只在客户端（localStorage），SSR 只会渲染未登录骨架并闪烁；这些页也无 SEO 需求。
    '/profile': { ssr: false },
    '/wallet': { ssr: false },
    '/settings': { ssr: false },
    '/login': { ssr: false },
    '/signup': { ssr: false },
    '/link': { ssr: false },
    '/auth/**': { ssr: false },
    '/apps/**': { ssr: false },
    // 公开用户主页：SSR（SEO / 分享 OG），数据经 server route 代理 getProfile；关系 / 应用等客户端补
    '/u/**': { ssr: true },
    '/feed': { ssr: false },
    '/test/**': { ssr: false },

    '/_nuxt/**': {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
    '/favicon.ico': {
      headers: {
        'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
    '/sw.js': {
      headers: {
        'cache-control': 'public, max-age=0, must-revalidate',
      },
    },
    '/ylf-logo.svg': {
      headers: {
        'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
    '/ylf.svg': {
      headers: {
        'cache-control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    },
  },

  experimental: {
    defaults: {
      nuxtLink: {
        // 关闭「视口可见即预取」避免首屏批量预取，保留「悬停/聚焦即预取」让导航接近瞬时
        prefetchOn: { visibility: false, interaction: true },
      },
    },
    payloadExtraction: true,
  },

  compatibilityDate: 'latest',

  nitro: {
    prerender: {
      // 显式列出内容页 + 关 crawlLinks（不爬 /apps、/wallet 等重的账号页），配合 build 脚本调高的 Node 堆避免预渲染 OOM。
      crawlLinks: false,
      routes: ['/', '/pricing', '/blog', '/blog/yunle-fun', '/changelog', '/developer', '/docs/getting-started', '/docs/getting-started/usage', '/docs/privacy-policy', '/docs/terms-of-service', '/docs/contact', '/docs/sitemap'],
      failOnError: false,
    },
  },

  vite: {
    // 落地页数据（content/*.yml）直接 import，无需 @nuxt/content（见 docs/nuxt-content-removal.md）
    // cast：@rollup/plugin-yaml 与 vite 内置 rollup 版本不同，类型不兼容（运行时无碍）
    plugins: [yaml() as unknown as Plugin],
    server: {
      allowedHosts: true,
    },
  },

  // 默认排除 /test/* 调试页面（如支付测试页），避免随生产构建上线。
  // 本地调试时用 `ENABLE_TEST_PAGES=true pnpm dev` 显式开启。
  // 注意：旧的 `ignore: ['pages/test/**']` 在 nuxt generate 下不可靠，故改用 pages:extend 钩子确定性移除。
  hooks: {
    'pages:extend': (pages) => {
      if (process.env.ENABLE_TEST_PAGES === 'true')
        return
      const removeTestPages = (list: typeof pages) => {
        for (let i = list.length - 1; i >= 0; i--) {
          const page = list[i]
          if (!page)
            continue
          if (page.path.startsWith('/test'))
            list.splice(i, 1)
          else if (page.children?.length)
            removeTestPages(page.children)
        }
      }
      removeTestPages(pages)
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
