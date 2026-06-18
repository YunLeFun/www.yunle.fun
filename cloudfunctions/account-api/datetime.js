/**
 * 时间工具（account-api 本地模块，非同步 lib）。
 *
 * 「每日签到」「每日投币上限」的日界一律按东八区（UTC+8）自然日，
 * 避免使用 UTC 导致北京时间早上 8 点才刷新。
 */

'use strict'

/** 东八区相对 UTC 的毫秒偏移 */
const CST_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * 把毫秒时间戳折算成东八区自然日 key（`YYYY-MM-DD`）。
 *
 * 用固定 UTC 偏移计算、再取 ISO 日期前缀，不依赖运行环境时区，
 * 保证云函数与单测结果一致。
 *
 * @param {number} now 毫秒时间戳
 * @returns {string}
 */
function cstDateKey(now) {
  if (typeof now !== 'number' || !Number.isFinite(now))
    throw new TypeError('cstDateKey: now 必须为数字')
  return new Date(now + CST_OFFSET_MS).toISOString().slice(0, 10)
}

module.exports = {
  CST_OFFSET_MS,
  cstDateKey,
}
