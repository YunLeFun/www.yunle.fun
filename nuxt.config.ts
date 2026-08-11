import type { Plugin } from 'vite'
import process from 'node:process'
import yaml from '@rollup/plugin-yaml'

const DEFAULT_ACCOUNT_API_HTTP_URL = 'https://api.yunle.fun/account-api'
const DEFAULT_APPS_PLATFORM_API_URL = 'https://apps.yunle.fun'
const DEFAULT_CLOUDBASE_STORAGE_PUBLIC_ORIGIN
  = 'https://7975-yunlefun-8g7ybcxc7345c490-1325586649.tcb.qcloud.la'
const EDGEONE_ACCOUNT_CLIENT_SHELL_ROUTES = [
  '/profile',
  '/wallet',
  '/settings',
  '/account-status',
  '/feed',
  '/apps',
  '/apps/new',
] as const
const EDGEONE_ACCOUNT_CLIENT_SHELL_RULES = Object.fromEntries(
  EDGEONE_ACCOUNT_CLIENT_SHELL_ROUTES.map(route => [
    route,
    { prerender: true, ssr: false },
  ]),
)

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    // UI 必须先于 MDC 注册，让带完整排版主题的 Prose* 组件接管 Markdown 标签。
    // 若顺序反过来，MDC 自带的无样式组件会抢先注册，文档标题/列表/表格退化为浏览器默认样式。
    '@nuxt/ui',
    // 业务 UI 使用本地 reka-ui 组件；图标由独立的 Nuxt Icon 提供。
    '@nuxt/icon',
    // Markdown 渲染（替代 @nuxt/content，见 docs/nuxt-content-removal.md）
    '@nuxtjs/mdc',
    '@vueuse/nuxt',
    // 双层会话迁移：用 nuxt-auth-utils 封 sealed httpOnly cookie 作持久会话（见 docs/cookie-session-migration.md）
    'nuxt-auth-utils',
    // '@nuxtjs/i18n', // 暂时禁用国际化，未来重新启用
  ],

  // Hybrid 渲染：默认 SSR。公开内容页（首页/文档/博客/定价/更新日志/开发者）走预渲染拿 SEO 与首屏；
  // 认证入口预渲染 client-only 壳并在浏览器接管登录态，其他账号 / 数据驱动页也继续走 client-only。各类策略都在 routeRules 声明。
  ssr: true,

  // shadcn-vue 组件由业务代码显式导入；避免 Nuxt 把目录中的 barrel 与同名 Vue 文件重复注册。
  components: {
    dirs: [{
      path: '~/components',
      pathPrefix: true,
      ignore: ['ui/**'],
    }],
  },

  devtools: {
    enabled: process.env.NODE_ENV === 'development',
  },

  // 预连接外部域名加速首屏
  app: {
    head: {
      link: [
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

  // 当前 content/ 公开内容没有代码块；关闭 MDC 的 Shiki 高亮器，避免为普通内容页加载 wasm/语言包。
  mdc: {
    highlight: false,
  },

  ui: {
    fonts: false,
  },

  runtimeConfig: {
    // CloudBase account-api 的公开 HTTP 访问地址（server 端 SSR 代理 getProfile 用）。
    // 官方生产域名是安全的只读默认值；本地/预发可用环境变量覆盖到对应环境。
    accountApiHttpUrl: process.env.NUXT_ACCOUNT_API_HTTP_URL || DEFAULT_ACCOUNT_API_HTTP_URL,
    // apps.yunle.fun 的受控目录 API；官网不再直读已设为 ADMINONLY 的应用/工坊集合。
    appsPlatformApiUrl: process.env.NUXT_APPS_PLATFORM_API_URL || DEFAULT_APPS_PLATFORM_API_URL,
    // 领取页服务端只用它把可信来源 IP 签成短时匿名凭证；必须与 account-api 配置一致。
    rewardClaimRateTicketSecret: process.env.NUXT_REWARD_CLAIM_RATE_TICKET_SECRET || '',
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
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || 'https://www.yunle.fun',
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      githubClientId: process.env.NUXT_PUBLIC_GITHUB_CLIENT_ID || '',
      cloudbaseEnvId: process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID || 'yunlefun-8g7ybcxc7345c490',
      cloudbaseStoragePublicOrigin: process.env.NUXT_PUBLIC_CLOUDBASE_STORAGE_PUBLIC_ORIGIN
        || DEFAULT_CLOUDBASE_STORAGE_PUBLIC_ORIGIN,
      cloudbaseRegion: process.env.NUXT_PUBLIC_CLOUDBASE_REGION || 'ap-shanghai',
      cloudbaseAccessKey: process.env.NUXT_PUBLIC_CLOUDBASE_ACCESS_KEY || '',
      // 双层会话总开关：true 时启用 cookie→ticket 启动恢复（httpOnly cookie 作 SSR 可读会话真值）。
      // 默认 false = 现状。prod 待铸票端点就绪后在 EdgeOne env 置 true。
      cookieSession: process.env.NUXT_PUBLIC_COOKIE_SESSION === 'true',
      // 内存化 token opt-in（需 cookieSession=true）：token 只存内存、不落 localStorage（XSS at-rest 硬化）。
      // 默认 false——启用前需先做「会话就绪前不发鉴权请求」门控，否则启动竞态会 403。见 docs/cookie-session-migration.md。
      cookieSessionMemory: process.env.NUXT_PUBLIC_COOKIE_SESSION_MEMORY === 'true',
      enableH5Pay: process.env.NUXT_PUBLIC_ENABLE_H5_PAY === 'true',
    },
  },

  routeRules: {
    '/auth/sso': {
      prerender: true,
      ssr: false,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow, noarchive',
      },
    },
    '/auth/github': { prerender: true, ssr: false },
    '/auth/callback': { prerender: true, ssr: false },
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
    '/explore': { prerender: true },
    '/download': { prerender: true },
    // 固定账号 / 数据页：预渲染 client-only 壳，确保 EdgeOne 输出客户端入口脚本。
    // CloudBase 登录态只在客户端恢复；静态壳不包含用户数据，可以安全复用。
    ...EDGEONE_ACCOUNT_CLIENT_SHELL_RULES,
    // 固定预渲染壳使用 URL fragment 携带领取 token：静态托管可直接服务，
    // 且 fragment 不会进入服务器访问日志或 Referer。
    '/claim': {
      prerender: true,
      ssr: false,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow, noarchive',
      },
    },
    // EdgeOne 的 Nuxt SSR 适配器不会为动态 client-only 页面注入客户端入口；
    // 固定认证入口预渲染 SPA 壳，保留客户端模块，查询参数继续由 onMounted / 客户端登录态处理。
    '/login': { prerender: true, ssr: false },
    '/signup': { prerender: true, ssr: false },
    '/link': { prerender: true, ssr: false },
    '/auth/**': { ssr: false },
    '/apps/download': { redirect: { to: '/download', statusCode: 301 } },
    // 动态应用路由无法枚举预渲染；保留 SSR 加载壳，数据仍在 onMounted / 会话就绪后从客户端读取。
    '/apps/**': { ssr: true },
    // 公开用户主页：SSR（SEO / 分享 OG），数据经 server route 代理 getProfile；关系 / 应用等客户端补
    '/u/**': { ssr: true },
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
      routes: ['/', '/pricing', '/blog', '/blog/yunle-fun', '/changelog', '/developer', '/explore', '/download', '/docs/getting-started', '/docs/getting-started/usage', '/docs/privacy-policy', '/docs/terms-of-service', '/docs/contact', '/docs/sitemap', '/login', '/signup', '/link', '/claim', '/auth/sso', '/auth/github', '/auth/callback', ...EDGEONE_ACCOUNT_CLIENT_SHELL_ROUTES],
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

  icon: {
    clientBundle: {
      // Nuxt UI Prose 与本地 reka-ui 组件有源码扫描无法发现的内部默认图标。
      icons: [
        'lucide:hash',
        'lucide:menu',
        'lucide:moon',
        'lucide:sun',
      ],
      scan: {
        globInclude: [
          'app/**/*.{vue,ts,js,mjs}',
          'content/**/*.{md,yml,yaml}',
          'docs/**/*.{md,yml,yaml}',
        ],
      },
      sizeLimitKb: 128,
    },
    provider: 'none',
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
