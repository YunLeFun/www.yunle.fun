/**
 * 双层会话客户端编排（见 docs/cookie-session-migration.md）。
 *
 * 串起「自有 httpOnly cookie 会话」与「CloudBase SDK 会话」两层：
 * - setServerSession：CloudBase 登录成功后，把原始 access/refresh token 封进 httpOnly cookie
 * - bootstrapFromCookie：启动时凭 cookie 取回原始 token，并用 auth.setSession 恢复同一 CloudBase 会话
 * - clearServerSession：登出清 cookie
 *
 * 全部容错：服务端会话端点不可用（如 SSR 运行时未托管）时不抛错，调用方回退到既有登录态。
 */
const SESSION_SYNC_TIMEOUT_MS = 5_000

function withSessionTimeout<T>(
  label: string,
  request: (options: { signal: AbortSignal, timeout: number }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`[session] ${label} timed out after ${SESSION_SYNC_TIMEOUT_MS}ms`))
    }, SESSION_SYNC_TIMEOUT_MS)
  })
  const requestPromise = request({
    timeout: SESSION_SYNC_TIMEOUT_MS,
    signal: controller.signal,
  })
  return Promise.race([requestPromise, timeoutPromise]).finally(() => {
    if (timer !== undefined)
      clearTimeout(timer)
  })
}

export function useServerSession() {
  const { auth } = useCloudbase()
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()
  const serverSession = (!import.meta.server && config.public.cookieSession)
    ? useUserSession()
    : null

  function getSessionEpoch(): number {
    return (nuxtApp._serverSessionEpoch as number | undefined) ?? 0
  }

  function enqueueCookieMutation<T>(task: () => Promise<T>): Promise<T> {
    const previous = (nuxtApp._serverSessionQueue as Promise<unknown> | undefined) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    nuxtApp._serverSessionQueue = next
    return next
  }

  async function sealCurrentSession(enqueuedEpoch: number): Promise<boolean> {
    if (getSessionEpoch() !== enqueuedEpoch)
      return false
    const { data } = await auth.getSession()
    if (getSessionEpoch() !== enqueuedEpoch)
      return false
    const accessToken = data?.session?.access_token
    const refreshToken = data?.session?.refresh_token
    if (!accessToken || !refreshToken)
      return false
    const pairKey = `${accessToken}:${refreshToken}`
    if (nuxtApp._serverSessionLastSealedPair === pairKey)
      return true
    const res = await withSessionTimeout('/api/session/login', opts =>
      $fetch<{ ok?: boolean, user?: { uid: string, name?: string }, loggedInAt?: number }>(
        '/api/session/login',
        { method: 'POST', body: { accessToken, refreshToken }, ...opts },
      ))
    // 若封签期间已触发 clearServerSession / 登出，丢弃过期响应避免回填登录态
    if (getSessionEpoch() !== enqueuedEpoch)
      return false
    nuxtApp._serverSessionLastSealedPair = pairKey
    if (serverSession && res?.user?.uid) {
      serverSession.session.value = {
        ...serverSession.session.value,
        user: res.user,
        loggedInAt: res.loggedInAt,
      }
    }
    return true
  }

  /** 登录成功后封原始令牌到 cookie。所有封签与清理按 FIFO 串行，防止乱序覆盖或漏删。 */
  async function setServerSession(): Promise<boolean> {
    if (import.meta.server)
      return false
    const enqueuedEpoch = getSessionEpoch()
    return await enqueueCookieMutation(async () => {
      try {
        return await sealCurrentSession(enqueuedEpoch)
      }
      catch (e) {
        console.warn('[session] setServerSession 失败（回退既有登录态）:', e)
        return false
      }
    })
  }

  /**
   * 启动：凭 httpOnly cookie 取出原始令牌，setSession 恢复**原始会话**。
   * 相比 custom-ticket，恢复的是原始会话（openid 正确 → 直读数据库可用）。
   * 无 cookie（bootstrap 返回 204）时静默返回 false。
   */
  async function bootstrapFromCookie(): Promise<boolean> {
    if (import.meta.server)
      return false
    const inflight = nuxtApp._serverSessionBootstrapInflight as Promise<boolean> | undefined
    if (inflight)
      return inflight

    const run = (async () => {
      const startEpoch = getSessionEpoch()
      try {
        const res = await withSessionTimeout('/api/session/bootstrap', opts =>
          $fetch<{ accessToken?: string, refreshToken?: string }>('/api/session/bootstrap', { method: 'POST', ...opts }))
        if (getSessionEpoch() !== startEpoch || !res?.accessToken || !res?.refreshToken)
          return false
        // setSession 内部用 refresh_token 刷新并恢复会话
        const { data, error } = await auth.setSession({
          access_token: res.accessToken,
          refresh_token: res.refreshToken,
        })
        if (getSessionEpoch() !== startEpoch || error || !data?.session)
          return false
        // 刷新会轮换一次性 refresh_token：必须等重封落地再继续，但即便重封暂时失败，
        // 只要期间未登出且 auth.setSession 已恢复 SDK 会话，仍应返回 true 避免误清当前登录态。
        await setServerSession().catch(() => false)
        return getSessionEpoch() === startEpoch
      }
      catch {
        return false
      }
    })().finally(() => {
      if (nuxtApp._serverSessionBootstrapInflight === run)
        nuxtApp._serverSessionBootstrapInflight = undefined
    })
    nuxtApp._serverSessionBootstrapInflight = run
    return await run
  }

  /** 登出清 cookie 并同步清理前端 serverSession 缓存态（CloudBase signOut 由调用方另行处理）。 */
  async function clearServerSession(): Promise<void> {
    if (import.meta.server)
      return
    nuxtApp._serverSessionEpoch = getSessionEpoch() + 1
    nuxtApp._serverSessionLastSealedPair = undefined
    if (serverSession)
      serverSession.session.value = null
    // 纳入统一 FIFO 队列：等待在途封签结束后再发 logout，同时确保后续新登录在 logout 完成后再封 cookie
    await enqueueCookieMutation(async () => {
      try {
        await withSessionTimeout('/api/session/logout', opts =>
          $fetch<{ ok?: boolean }>('/api/session/logout', { method: 'POST', ...opts }))
      }
      catch {}
    })
  }

  return { setServerSession, bootstrapFromCookie, clearServerSession }
}
