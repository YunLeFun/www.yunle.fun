/**
 * 默认昵称生成。
 *
 * 手机 OTP 注册的用户，CloudBase 默认昵称就是「完整手机号」——既泄露 PII，
 * 展示也不体面（见 utils/mask.ts）。社区最佳实践是从源头给一个友好的默认昵称，
 * 而非把手机号当昵称。
 *
 * 设计取向「默认名＝得体的工服，不是演出服」：固定品牌前缀「云游者」（一词同扣
 * 「云」与「游/乐」，统一可认）+ 一段由 uid 派生的稳定后缀，例如「云游者_k7m2」：
 * - 由 uid 派生：同一用户永远得到同一个名，幂等可重放；
 * - 后缀承担辨识：剔除易混字符（0 1 i l o）的 base36，低碰撞、不易抄错；
 * - 不含手机号：杜绝 PII 泄露；
 * - 低存在感：一眼像「默认占位」，促使用户去首登引导里改成自己的名。
 *
 * 前端在登录后把默认昵称写回 CloudBase Auth；云函数侧使用同一算法兜底公开资料、
 * 历史脏数据和服务端占位文档。即使旧客户端或 Auth 写回失败，公开展示也不会退化或泄露手机号。
 */

/** 品牌固定前缀：一词同扣「云」与「游/乐」，所有默认名统一可认 */
const NICKNAME_PREFIX = '云游者'

/** 后缀字符集：base36 去掉易混的 0 1 i l o，避免照着念错 / 抄错（共 31 个） */
const SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

/** 后缀长度：31^4 ≈ 92 万空间，单前缀下仍几乎不重名 */
const SUFFIX_LEN = 4

/**
 * djb2 字符串散列，返回 32 位无符号整数。稳定、无依赖、分布均匀，
 * 足以用于从 uid 派生展示用的伪随机后缀（非密码学用途）。
 */
function hashString(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++)
    h = (((h << 5) + h) + input.charCodeAt(i)) >>> 0
  return h
}

/**
 * 由稳定种子（通常是 uid）生成默认昵称，如「云游者_k7m2」。
 * 同一 seed 始终得到同一结果（幂等）。
 */
export function generateDefaultNickname(seed?: string | null): string {
  const s = (seed && seed.trim()) || 'guest'
  let h = hashString(`yunle:${s}`)
  let suffix = ''
  for (let i = 0; i < SUFFIX_LEN; i++) {
    suffix += SUFFIX_ALPHABET[h % SUFFIX_ALPHABET.length]
    // LCG 步进充分扩散：让相近种子（如顺序 uid）各位都不同，而非仅末位变化
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
  }
  return `${NICKNAME_PREFIX}_${suffix}`
}
