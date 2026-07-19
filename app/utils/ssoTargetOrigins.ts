export interface SsoTargetRule {
  exactOrigin?: string
  subdomainSuffix?: string
  loopbackHost?: boolean
  protocol?: string
  port?: string
}

export interface SsoTargetRulesOptions {
  allowLocal?: boolean
}

export const LOCAL_SSO_TARGET_RULES: readonly SsoTargetRule[] = [
  { loopbackHost: true, protocol: 'http:', port: '*' },
]

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

function isIpv4LoopbackHost(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => {
      if (!/^\d+$/.test(part))
        return false
      const value = Number(part)
      return value >= 0 && value <= 255
    })
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = normalizeHost(host)
  return normalizedHost === 'localhost'
    || normalizedHost === '[::1]'
    || isIpv4LoopbackHost(normalizedHost)
}

function parseExactRule(value: string): SsoTargetRule | null {
  try {
    if (value.includes('*'))
      return null
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value.replace(/\/$/, ''))
      return null
    return { exactOrigin: url.origin }
  }
  catch {
    return null
  }
}

function parseHttpsSubdomainRule(value: string): SsoTargetRule | null {
  const match = /^https:\/\/\*\.([^/:?#]+)\/?$/i.exec(value)
  if (!match?.[1])
    return null

  try {
    const url = new URL(`https://${match[1]}`)
    const hostname = normalizeHost(url.hostname)
    const labels = hostname.split('.')
    if (url.hostname.endsWith('.')
      || url.port
      || labels.length < 2
      || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      || isLoopbackHost(hostname)) {
      return null
    }
    return { subdomainSuffix: hostname, protocol: 'https:', port: '' }
  }
  catch {
    return null
  }
}

export function parseSsoTargetRule(value: string): SsoTargetRule | null {
  const trimmed = value.trim()
  if (!trimmed)
    return null
  if (trimmed.includes('*'))
    return parseHttpsSubdomainRule(trimmed)
  return parseExactRule(trimmed)
}

export function readSsoTargetRules(value: unknown): SsoTargetRule[] {
  if (typeof value !== 'string')
    return []

  return value
    .split(',')
    .map(parseSsoTargetRule)
    .filter((rule): rule is SsoTargetRule => !!rule)
}

export function createSsoTargetRules(value: unknown, options: SsoTargetRulesOptions = {}): SsoTargetRule[] {
  return [
    ...readSsoTargetRules(value),
    ...(options.allowLocal ? LOCAL_SSO_TARGET_RULES : []),
  ]
}

function portMatches(rulePort: string | undefined, port: string): boolean {
  return rulePort === '*' || (rulePort ?? '') === port
}

export function isAllowedSsoTargetOrigin(origin: string, rules: readonly SsoTargetRule[]): boolean {
  let url: URL
  try {
    url = new URL(origin)
  }
  catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return false
  if (url.origin !== origin || url.hostname.endsWith('.'))
    return false

  return rules.some((rule) => {
    if (rule.exactOrigin)
      return url.origin === rule.exactOrigin
    if (rule.protocol && url.protocol !== rule.protocol)
      return false
    if (!portMatches(rule.port, url.port))
      return false
    if (rule.loopbackHost)
      return isLoopbackHost(url.hostname)
    if (rule.subdomainSuffix) {
      const hostname = normalizeHost(url.hostname)
      return hostname !== rule.subdomainSuffix
        && hostname.endsWith(`.${rule.subdomainSuffix}`)
    }
    return false
  })
}
