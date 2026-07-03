export interface SsoTargetRule {
  exactOrigin?: string
  wildcardHost?: string
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

function isValidHostSuffix(host: string): boolean {
  const labels = host.split('.')
  return labels.length >= 2 && labels.every(label =>
    /^[a-z0-9-]+$/i.test(label) && !label.startsWith('-') && !label.endsWith('-'),
  )
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

function parseWildcardRule(value: string): SsoTargetRule | null {
  const bare = value.match(/^\*\.([a-z0-9.-]+)$/i)
  if (bare) {
    const host = bare[1]
    if (!host)
      return null
    const wildcardHost = normalizeHost(host)
    return isValidHostSuffix(wildcardHost)
      ? { wildcardHost, protocol: 'https:', port: '' }
      : null
  }

  const withProtocol = value.match(/^([a-z][a-z0-9+.-]*):\/\/\*\.([^/?#]+)\/?$/i)
  if (!withProtocol)
    return null

  try {
    const probe = new URL(`${withProtocol[1]}://placeholder.${withProtocol[2]}`)
    if (probe.protocol !== 'http:' && probe.protocol !== 'https:')
      return null

    const wildcardHost = normalizeHost(probe.hostname.replace(/^placeholder\./, ''))
    return isValidHostSuffix(wildcardHost)
      ? { wildcardHost, protocol: probe.protocol, port: probe.port }
      : null
  }
  catch {
    return null
  }
}

function parseExactRule(value: string): SsoTargetRule | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return null
    return { exactOrigin: url.origin }
  }
  catch {
    return null
  }
}

export function parseSsoTargetRule(value: string): SsoTargetRule | null {
  const trimmed = value.trim()
  if (!trimmed)
    return null
  return parseWildcardRule(trimmed) ?? parseExactRule(trimmed)
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

function hostMatchesWildcard(host: string, wildcardHost: string): boolean {
  const normalizedHost = normalizeHost(host)
  return normalizedHost !== wildcardHost && normalizedHost.endsWith(`.${wildcardHost}`)
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

  return rules.some((rule) => {
    if (rule.exactOrigin)
      return url.origin === rule.exactOrigin
    if (rule.protocol && url.protocol !== rule.protocol)
      return false
    if (!portMatches(rule.port, url.port))
      return false
    if (rule.loopbackHost)
      return isLoopbackHost(url.hostname)
    if (!rule.wildcardHost)
      return false
    return hostMatchesWildcard(url.hostname, rule.wildcardHost)
  })
}
