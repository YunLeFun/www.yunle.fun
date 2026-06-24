import cloudbase from '@cloudbase/js-sdk'

type TcbApp = ReturnType<typeof cloudbase.init>
type TcbAuth = ReturnType<TcbApp['auth']>

/** @cloudbase/oauth 的 SimpleStorage 接口（SDK 用它读写 credentials_<env> 等） */
interface SimpleStorage {
  getItem: (key: string) => Promise<string | null>
  removeItem: (key: string) => Promise<void>
  setItem: (key: string, value: string) => Promise<void>
  getItemSync: (key: string) => string | null
  removeItemSync: (key: string) => void
  setItemSync: (key: string, value: string) => void
}

/**
 * 纯内存 storage：注入给 CloudBase SDK 后，token（credentials_<env>）只存内存、不落 localStorage。
 * 关页/刷新即丢，由 httpOnly cookie→setSession 重建（双层会话）。消除 token 的「at-rest 持久窃取」面。
 */
function createMemoryStorage(): SimpleStorage {
  const m = new Map<string, string>()
  return {
    getItem: async k => (m.has(k) ? m.get(k)! : null),
    removeItem: async (k) => {
      m.delete(k)
    },
    setItem: async (k, v) => {
      m.set(k, v)
    },
    getItemSync: k => (m.has(k) ? m.get(k)! : null),
    removeItemSync: (k) => {
      m.delete(k)
    },
    setItemSync: (k, v) => {
      m.set(k, v)
    },
  }
}

/**
 * CloudBase SDK 全局单例（SSR 安全）
 * 使用 useNuxtApp 在请求级别隔离实例
 */
export function useCloudbase() {
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()

  // SSR 时返回空占位，CloudBase 认证仅在客户端使用
  if (import.meta.server) {
    return { app: null as unknown as TcbApp, auth: null as unknown as TcbAuth }
  }

  // 已初始化则直接返回缓存
  const cachedApp = nuxtApp._cloudbaseApp as TcbApp | undefined
  const cachedAuth = nuxtApp._cloudbaseAuth as TcbAuth | undefined
  if (cachedApp && cachedAuth) {
    return { app: cachedApp, auth: cachedAuth }
  }

  // 实测 @cloudbase/js-sdk@3.3.13 的 persistence 只认 'local'（'session'/'none' 都回落 localStorage）。
  // 故 token 移出 JS 不靠 persistence，而靠注入「内存 storage」：cookieSession 开启时 credentials_<env>
  // 只存内存、不落 localStorage，关页/刷新由 httpOnly cookie→setSession 重建。见 docs/cookie-session-migration.md。
  const persistence = 'local'
  // 内存化已验证可把 token 移出 localStorage（实测 credentials_<env> 不再落盘、会话由 cookie 重建），
  // 但会引入「启动竞态」：bootstrap 完成前提前触发的鉴权调用会 403。需先做「会话就绪前不发鉴权请求」
  // 的门控，故单独 opt-in 开关、默认关，避免污染主 cookieSession 路径。见 docs/cookie-session-migration.md。
  const memoryStorage = (config.public.cookieSession && config.public.cookieSessionMemory)
    ? createMemoryStorage()
    : undefined
  const authExtra = memoryStorage ? { storage: memoryStorage } : {}

  // 初始化 CloudBase SDK
  const app: TcbApp = cloudbase.init({
    env: config.public.cloudbaseEnvId as string,
    region: config.public.cloudbaseRegion as string,
    accessKey: config.public.cloudbaseAccessKey as string,
    persistence,
    auth: {
      // 不让 SDK 自动消费 URL 中的 OAuth code/state：
      // 自动模式在交换完成后会执行 window.location.replace 整页刷新，
      // 与回调页的状态检查产生竞态（先闪「登录失败」再刷新成「成功」），
      // 且绑定（bind_identity）结果无法被页面感知。
      // OAuth 回调统一由 /auth/callback 显式调用 grantProviderToken 处理。
      detectSessionInUrl: false,
      ...authExtra,
    },
  })
  const auth: TcbAuth = app.auth({ persistence, ...authExtra })

  nuxtApp._cloudbaseApp = app
  nuxtApp._cloudbaseAuth = auth

  return { app, auth }
}
