/**
 * 双层会话端点的安全护栏（见 docs/cookie-session-migration.md · Phase 5）。
 *
 * `/api/session/*` 靠 httpOnly cookie 鉴权，天然受 CSRF 威胁。这里提供两道纵深防御，
 * 与 cookie 的 SameSite=Lax 形成双保险：
 * 1. assertSameOrigin —— 状态变更类端点必须由本站页面发起（校验 Origin 与请求 host 同源）；
 * 2. rateLimit —— 进程内最佳努力限速，防 bootstrap/login 被刷。
 *
 * server/utils 下的导出会被 Nitro 自动导入，端点内可直接调用。
 */
import type { H3Event } from 'h3'
import { createError, getHeader, getRequestHost, getRequestIP } from 'h3'

const PRODUCTION_HOSTS = ['www.yunle.fun']

function addHeaderHosts(hosts: Set<string>, value: string | undefined): void {
  if (!value)
    return
  for (const rawHost of value.split(',')) {
    const host = rawHost.trim().toLowerCase()
    if (host)
      hosts.add(host)
  }
}

function addForwardedHosts(hosts: Set<string>, value: string | undefined): void {
  if (!value)
    return
  for (const entry of value.split(',')) {
    const match = entry.match(/(?:^|;)\s*host="?([^";,]+)"?/i)
    if (match?.[1])
      hosts.add(match[1].trim().toLowerCase())
  }
}

function addUrlHost(hosts: Set<string>, value: string | undefined): void {
  if (!value)
    return
  try {
    hosts.add(new URL(value).host.toLowerCase())
  }
  catch {
    // Ignore malformed optional config; Origin parsing above still enforces validity.
  }
}

function getSameOriginHostCandidates(event: H3Event): Set<string> {
  const hosts = new Set<string>()
  addHeaderHosts(hosts, getRequestHost(event, { xForwardedHost: true }))
  addHeaderHosts(hosts, getHeader(event, 'host'))
  addHeaderHosts(hosts, getHeader(event, 'x-forwarded-host'))
  addHeaderHosts(hosts, getHeader(event, 'x-original-host'))
  addHeaderHosts(hosts, getHeader(event, 'x-host'))
  addHeaderHosts(hosts, getHeader(event, 'x-real-host'))
  addForwardedHosts(hosts, getHeader(event, 'forwarded'))
  addUrlHost(hosts, useRuntimeConfig(event).public.siteUrl)
  for (const host of PRODUCTION_HOSTS)
    hosts.add(host)
  return hosts
}

/**
 * 同源校验：浏览器对非 GET 请求（含同源 POST）必带 Origin；缺失或与请求 host 不符一律 403。
 * 配合 cookie SameSite=Lax，挡住跨站伪造请求带着 cookie 调用本站会话端点。
 */
export function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  if (!origin)
    throw createError({ statusCode: 403, statusMessage: 'forbidden: missing Origin' })
  let originHost: string
  try {
    originHost = new URL(origin).host
  }
  catch {
    throw createError({ statusCode: 403, statusMessage: 'forbidden: bad Origin' })
  }
  const hosts = getSameOriginHostCandidates(event)
  if (!hosts.has(originHost.toLowerCase()))
    throw createError({ statusCode: 403, statusMessage: 'forbidden: cross-origin' })
}

interface Bucket { count: number, resetAt: number }
const buckets = new Map<string, Bucket>()

/**
 * 进程内固定窗口限速。⚠️ serverless / 边缘多实例下是「每实例」限速、非全局，仅作最佳努力；
 * 要全局限速需接 KV/Redis 等共享存储（待办）。
 */
export function rateLimit(
  event: H3Event,
  opts: { key: string, limit: number, windowMs: number },
): void {
  const now = Date.now()
  // 机会式清理过期桶，避免长驻进程内存无界增长
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now)
        buckets.delete(k)
    }
  }
  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const key = `${opts.key}:${ip}`
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
    return
  }
  if (bucket.count >= opts.limit)
    throw createError({ statusCode: 429, statusMessage: 'too many requests' })
  bucket.count++
}
