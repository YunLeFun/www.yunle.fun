import { Buffer } from 'node:buffer'

const ENV_PLACEHOLDER_RE = /^\{\{env\.([A-Z_][A-Z0-9_]*)\}\}$/
const REWARD_CLAIM_SECRET_NAMES = [
  'REWARD_CLAIM_LINK_HASH_KEY',
  'REWARD_CLAIM_RATE_TICKET_SECRET',
]

const TEST_IDENTITY_BASE64_NAMES = [
  'TEST_TICKET_ESCROW_KEY',
  'TEST_LEASE_CAPABILITY_SIGNING_KEY',
  'TEST_BROKER_SWEEP_KEY',
]

const INDEPENDENT_SERVICE_TOKEN_NAMES = [
  'ACCOUNT_API_INTERNAL_TOKEN',
  'ADVJS_AI_RUNTIME_ACCOUNT_API_TOKEN',
  'AI_GATEWAY_ACCOUNT_API_TOKEN',
  'PLAY_PACHINKO_ACCOUNT_API_TOKEN',
  'TEST_BROKER_ACCOUNT_API_TOKEN',
  'TEST_BROKER_INTERNAL_TOKEN',
  'TEST_BROKER_RECONCILE_TOKEN',
]

export function requiredEnvironmentNames(config, functionNames) {
  const configuredFunctions = Array.isArray(config?.functions) ? config.functions : []
  const names = []

  for (const functionName of functionNames) {
    const configured = configuredFunctions.find(item => item?.name === functionName)
    if (!configured)
      throw new Error(`cloudbaserc.json 未声明云函数：${functionName}`)

    for (const value of Object.values(configured.envVariables || {})) {
      const name = typeof value === 'string' ? value.match(ENV_PLACEHOLDER_RE)?.[1] : undefined
      if (name && !names.includes(name))
        names.push(name)
    }
  }

  return names
}

export function assertFunctionEnvironmentReady(config, functionNames, env) {
  const requiredNames = requiredEnvironmentNames(config, functionNames)
  const missingNames = requiredNames.filter((name) => {
    const value = env?.[name]
    return typeof value !== 'string' || Buffer.byteLength(value.trim(), 'utf8') === 0
  })
  if (missingNames.length > 0)
    throw new Error(`拒绝部署：缺少环境变量：${missingNames.join(', ')}`)

  if (requiredNames.includes('AUTH_ISSUER_ENVIRONMENT') && env.AUTH_ISSUER_ENVIRONMENT !== 'production')
    throw new Error('拒绝部署：生产 cloudbaserc 要求 AUTH_ISSUER_ENVIRONMENT=production')

  for (const name of REWARD_CLAIM_SECRET_NAMES) {
    if (requiredNames.includes(name) && Buffer.byteLength(env[name], 'utf8') < 32)
      throw new Error(`拒绝部署：${name} 必须至少 32 字节`)
  }

  const [linkHashKey, rateTicketSecret] = REWARD_CLAIM_SECRET_NAMES.map(name => env?.[name])
  if (linkHashKey && rateTicketSecret && linkHashKey === rateTicketSecret)
    throw new Error('拒绝部署：领取链接摘要密钥与速率凭证密钥不能复用')

  for (const name of TEST_IDENTITY_BASE64_NAMES) {
    if (requiredNames.includes(name) && !isCanonical32ByteBase64(env[name]))
      throw new Error(`拒绝部署：${name} 必须是标准 32-byte base64`)
  }

  for (const name of INDEPENDENT_SERVICE_TOKEN_NAMES) {
    if (requiredNames.includes(name) && !isSecureToken(env[name]))
      throw new Error(`拒绝部署：${name} 必须是 32～512 bytes 的独立高熵令牌`)
  }

  const independentSecretNames = [
    ...REWARD_CLAIM_SECRET_NAMES,
    ...TEST_IDENTITY_BASE64_NAMES,
    ...INDEPENDENT_SERVICE_TOKEN_NAMES,
  ].filter(name => requiredNames.includes(name))
  const independentSecretValues = independentSecretNames.map(name => env[name])
  if (new Set(independentSecretValues).size !== independentSecretValues.length)
    throw new Error('拒绝部署：测试身份、账号与奖励凭据不能跨用途复用')

  return requiredNames
}

/**
 * Escape values before CloudBase CLI performs raw `{{env.NAME}}` substitution
 * inside JSON string literals. JSON parsing restores the original value.
 */
export function createCloudBaseConfigEnvironment(config, env) {
  const functionNames = (Array.isArray(config?.functions) ? config.functions : [])
    .map(item => item?.name)
    .filter(name => typeof name === 'string' && name)
  const childEnvironment = { ...env }

  for (const name of requiredEnvironmentNames(config, functionNames)) {
    if (typeof env?.[name] === 'string')
      childEnvironment[name] = JSON.stringify(env[name]).slice(1, -1)
  }
  return childEnvironment
}

function isCanonical32ByteBase64(value) {
  if (typeof value !== 'string' || !/^[a-z0-9+/]{43}=$/i.test(value))
    return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}

function isSecureToken(value) {
  const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0
  return length >= 32 && length <= 512
}
