// 双层会话 httpOnly cookie 的类型（见 docs/cookie-session-migration.md）
// 放在 shared/：Nuxt 的 app 与 server 两套 tsconfig 都 include `shared/**/*.d.ts`，
// 故对客户端 useUserSession() 与服务端 setUserSession()/requireUserSession() 同时生效。
// sealed session 仅存展示/路由所需最小字段，敏感数据仍由 CloudBase 持有。
declare module '#auth-utils' {
  interface User {
    uid: string
    name?: string
  }
  interface UserSession {
    loggedInAt?: number
  }
  // 仅服务端可读（useUserSession() 客户端不下发）：封原始 CloudBase 令牌，
  // 启动时由服务端取出回传给客户端 auth.setSession() 恢复「原始会话」（openid 正确 → 直读 DB 可用）。
  interface SecureSessionData {
    accessToken?: string
    refreshToken?: string
  }
}

export {}
