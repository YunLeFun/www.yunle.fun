/**
 * 隐私脱敏工具。
 *
 * 手机 OTP 注册的用户，CloudBase 默认昵称就是「完整手机号」（见 mapCloudbaseUser：
 * nickname 取自 user_metadata.nickName）。该昵称会经 user_profiles 流向关注/粉丝列表、
 * 动态流、公开主页、通知等「展示他人身份」的位置——若不脱敏，等于把对方手机号公开。
 *
 * 因此：凡是渲染「他人」昵称之处，一律走 displayUserName()；渲染手机号一律走 maskPhone()。
 */

/** 中国大陆手机号：11 位、1[3-9] 开头 */
const CN_MOBILE_RE = /^1[3-9]\d{9}$/

/**
 * 手机号脱敏：`15906608053` → `159****8053`。
 * 非标准 11 位手机号时，对 ≥7 位的纯数字保留首 3 尾 2，其余原样返回。
 */
export function maskPhone(phone: string): string {
  const s = String(phone ?? '').trim()
  if (CN_MOBILE_RE.test(s))
    return s.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  if (/^\d{7,}$/.test(s))
    return `${s.slice(0, 3)}****${s.slice(-2)}`
  return s
}

/** 判断一个展示名是否其实是裸手机号（OTP 默认昵称的典型形态） */
export function looksLikePhone(name?: string | null): boolean {
  return !!name && CN_MOBILE_RE.test(name.trim())
}

/**
 * 安全展示「他人」用户名：
 * - 昵称为空 → 占位名（fallback）
 * - 昵称其实是手机号 → 脱敏（159****8053）
 * - 否则原样返回
 *
 * @param name 用户昵称（可能为空 / 可能是手机号）
 * @param fallback 空昵称时的占位名
 */
export function displayUserName(name?: string | null, fallback = '云乐坊用户'): string {
  const s = (name ?? '').trim()
  if (!s)
    return fallback
  return looksLikePhone(s) ? maskPhone(s) : s
}
