/**
 * GitHub App 仓库连接（含私有仓库）。对接 github-api 云函数。
 *
 * 未连接时 `getConnection` 返回 connected:false，调用方（GitHubRepoField）
 * 回退到 GitHubRepoInput 的匿名公开仓库校验。详见 docs/github-app-integration.md。
 */

/** 安装回调页所在 origin（github-api 函数挂在 api.yunle.fun）。 */
const CALLBACK_ORIGIN = 'https://api.yunle.fun'

export interface GitHubAppRepo {
  fullName: string
  private: boolean
  language: string | null
  stargazers: number
  description: string | null
  updatedAt: string | null
}

export interface GitHubAppConnection {
  connected: boolean
  githubLogin?: string
  accountType?: string
  repositorySelection?: string
}

export function useGitHubApp() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  // 全局共享连接态，避免每个组件各查一次
  const connection = useState<GitHubAppConnection | null>('github_app_connection', () => null)
  const loading = ref(false)

  const isConnected = computed(() => !!connection.value?.connected)
  const githubLogin = computed(() => connection.value?.githubLogin || '')

  async function call<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    if (!app || !user.value)
      throw new Error('请先登录')
    const res = await app.callFunction({ name: 'github-api', data: { action, ...data } })
    return res.result as T
  }

  async function refreshConnection(): Promise<GitHubAppConnection> {
    if (!app || !user.value) {
      connection.value = { connected: false }
      return connection.value
    }
    loading.value = true
    try {
      connection.value = await call<GitHubAppConnection>('getConnection')
    }
    catch {
      connection.value = { connected: false }
    }
    finally {
      loading.value = false
    }
    return connection.value
  }

  function listRepos(query?: string, page?: number) {
    return call<{ repos: GitHubAppRepo[], hasMore: boolean }>('listRepos', { query, page })
  }

  function checkRepo(repo: string) {
    return call<{ exists: boolean, meta?: GitHubAppRepo }>('checkRepo', { repo })
  }

  async function disconnect(): Promise<void> {
    await call('disconnect')
    connection.value = { connected: false }
  }

  /**
   * 弹窗连接 GitHub App（复用 useOAuth.linkIdentity 的弹窗 + postMessage 范式）。
   * 注意：回调页在 api.yunle.fun，postMessage 的 origin 是 CALLBACK_ORIGIN，
   * 与登录 OAuth（同源 /auth/callback）不同，故按 CALLBACK_ORIGIN 校验。
   */
  async function connect(): Promise<void> {
    // 把当前站点 origin 传给后端签进 state，回调据此把 postMessage 发回本站
    const { url } = await call<{ url: string }>('getInstallUrl', { origin: window.location.origin })

    const width = 600
    const height = 760
    const left = window.screenX + (window.outerWidth - width) / 2
    const top = window.screenY + (window.outerHeight - height) / 2
    const popup = window.open(
      url,
      'github_app_install',
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    )
    if (!popup)
      throw new Error('弹窗被拦截，请允许弹窗后重试')

    await new Promise<void>((resolve, reject) => {
      let pollTimer: ReturnType<typeof setInterval>

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== CALLBACK_ORIGIN)
          return
        if (event.data?.type !== 'github_app_callback')
          return
        window.removeEventListener('message', onMessage)
        clearInterval(pollTimer)
        if (event.data.success)
          resolve()
        else
          reject(new Error(event.data.message || '连接失败'))
      }

      window.addEventListener('message', onMessage)
      pollTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollTimer)
          window.removeEventListener('message', onMessage)
          reject(new Error('连接窗口已关闭'))
        }
      }, 500)
    })

    await refreshConnection()
  }

  return {
    connection: readonly(connection),
    loading: readonly(loading),
    isConnected,
    githubLogin,
    refreshConnection,
    listRepos,
    checkRepo,
    connect,
    disconnect,
  }
}
