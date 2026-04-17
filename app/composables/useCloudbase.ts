import cloudbase from '@cloudbase/js-sdk'

type TcbApp = ReturnType<typeof cloudbase.init>
type TcbAuth = ReturnType<TcbApp['auth']>

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

  // 初始化 CloudBase SDK
  const app: TcbApp = cloudbase.init({
    env: config.public.cloudbaseEnvId as string,
    region: config.public.cloudbaseRegion as string,
    accessKey: config.public.cloudbaseAccessKey as string,
    persistence: 'local' as const,
    auth: {
      detectSessionInUrl: true,
    },
  })
  const auth: TcbAuth = app.auth({ persistence: 'local' })

  nuxtApp._cloudbaseApp = app
  nuxtApp._cloudbaseAuth = auth

  return { app, auth }
}
