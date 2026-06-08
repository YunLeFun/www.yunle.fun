/**
 * 应用上架相关配置。
 *
 * 开发者平台（第三方自助发布）尚未上线，目前仅「官方账号」可以发布 / 上架应用，
 * 普通用户的自助创建入口暂时隐藏（详见 /apps、/profile、/apps/new 的判断）。
 *
 * TODO: 确认官方账号的真实 ownerLogin（即登录后存入 `apps.ownerLogin` 的值，
 * 通常是 GitHub 登录名）。如有多个官方账号，按需追加。
 */
export const OFFICIAL_OWNER_LOGINS = ['YunYouJun']

/** 判断某个 ownerLogin 是否为官方账号 */
export function isOfficialOwner(login?: string | null): boolean {
  return !!login && OFFICIAL_OWNER_LOGINS.includes(login)
}
