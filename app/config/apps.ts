/**
 * 应用上架相关配置。
 *
 * 开发者平台（第三方自助发布）尚未上线，目前仅「官方账号」可以发布 / 上架应用，
 * 普通用户的自助创建入口暂时隐藏（详见 /apps、/profile、/apps/new 的判断）。
 *
 * 官方账号判定（满足任一即可）：
 * 1. 登录名（ownerLogin）在 OFFICIAL_OWNER_LOGINS 中（大小写不敏感）；
 * 2. 邮箱域名以 OFFICIAL_EMAIL_DOMAINS 中任一结尾（含子域名）。
 */

/** 官方账号登录名（GitHub login 等），大小写不敏感 */
export const OFFICIAL_OWNER_LOGINS = ['YunLeFun', 'YunYouJun']

/** 官方邮箱域名，邮箱以这些域名（或其子域名）结尾即视为官方 */
export const OFFICIAL_EMAIL_DOMAINS = ['yunyoujun.cn', 'yunle.fun']

/** 判断邮箱（或裸域名）是否归属官方域名 */
function matchesOfficialDomain(email?: string | null): boolean {
  if (!email)
    return false
  const domain = (email.includes('@') ? email.split('@').pop()! : email).toLowerCase()
  return OFFICIAL_EMAIL_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))
}

/**
 * 判断某个 ownerLogin 是否为官方账号（仅按登录名，大小写不敏感）。
 * 用于只有 ownerLogin、拿不到邮箱的场景（如应用记录过滤）。
 */
export function isOfficialOwner(login?: string | null): boolean {
  if (!login)
    return false
  const lower = login.toLowerCase()
  return OFFICIAL_OWNER_LOGINS.some(l => l.toLowerCase() === lower)
}

/** 可用于官方判定的用户信息（login 或 email 命中其一即为官方） */
export interface OfficialUserLike {
  login?: string | null
  email?: string | null
}

/** 判断当前用户是否为官方账号（登录名命中，或邮箱域名命中） */
export function isOfficialUser(user?: OfficialUserLike | null): boolean {
  if (!user)
    return false
  return isOfficialOwner(user.login) || matchesOfficialDomain(user.email)
}
