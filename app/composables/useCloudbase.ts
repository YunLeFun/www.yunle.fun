import cloudbase from '@cloudbase/js-sdk'

type TcbApp = ReturnType<typeof cloudbase.init>

let _app: TcbApp | null = null
let _auth: ReturnType<TcbApp['auth']> | null = null

/**
 * CloudBase SDK 全局单例
 * 提供 app 和 auth 实例
 */
export function useCloudbase() {
  const config = useRuntimeConfig()

  if (!_app) {
    _app = cloudbase.init({
      env: config.public.cloudbaseEnvId as string,
      region: config.public.cloudbaseRegion as string,
      accessKey: config.public.cloudbaseAccessKey as string,
      persistence: 'local' as const,
    })
  }

  if (!_auth) {
    _auth = _app.auth({ persistence: 'local' })
  }

  return {
    app: _app,
    auth: _auth,
  }
}
