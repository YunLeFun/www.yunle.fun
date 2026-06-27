'use strict'

/**
 * 默认昵称生成（云函数侧）。
 *
 * 必须与前端 app/utils/displayName.ts **逐字节同算法**：同一 uid 在前端登录写回、
 * 在后端批量回填时都生成同一个「云游者_xxxx」，两边不会打架。改任一处务必同步另一处，
 * 并跑 tests/account-api/displayName.test.js 的跨端黄金向量断言。
 *
 * 设计取向见前端文件注释：固定品牌前缀「云游者」+ uid 派生的去混淆 base36 后缀，
 * 幂等、低碰撞、无 PII。
 */

/** 品牌固定前缀 */
const NICKNAME_PREFIX = '云游者'

/** 后缀字符集：base36 去掉易混的 0 1 i l o（共 31 个） */
const SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'

/** 后缀长度 */
const SUFFIX_LEN = 4

/** djb2 字符串散列，返回 32 位无符号整数（非密码学用途，仅用于稳定派生后缀） */
function hashString(input) {
  let h = 5381
  for (let i = 0; i < input.length; i++)
    h = (((h << 5) + h) + input.charCodeAt(i)) >>> 0
  return h
}

/**
 * 由稳定种子（通常是 uid）生成默认昵称，如「云游者_k7m2」。同一 seed 始终同结果。
 * @param {string} [seed]
 * @returns {string}
 */
function generateDefaultNickname(seed) {
  const s = (seed && String(seed).trim()) || 'guest'
  let h = hashString(`yunle:${s}`)
  let suffix = ''
  for (let i = 0; i < SUFFIX_LEN; i++) {
    suffix += SUFFIX_ALPHABET[h % SUFFIX_ALPHABET.length]
    // LCG 步进充分扩散：让相近种子（如顺序 uid）各位都不同，而非仅末位变化
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
  }
  return `${NICKNAME_PREFIX}_${suffix}`
}

module.exports = { generateDefaultNickname }
