import { Buffer } from 'node:buffer'

const ENV_PLACEHOLDER_RE = /^\{\{env\.([A-Z_][A-Z0-9_]*)\}\}$/
const REWARD_CLAIM_SECRET_NAMES = [
  'REWARD_CLAIM_LINK_HASH_KEY',
  'REWARD_CLAIM_RATE_TICKET_SECRET',
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

  for (const name of REWARD_CLAIM_SECRET_NAMES) {
    if (requiredNames.includes(name) && Buffer.byteLength(env[name], 'utf8') < 32)
      throw new Error(`拒绝部署：${name} 必须至少 32 字节`)
  }

  const [linkHashKey, rateTicketSecret] = REWARD_CLAIM_SECRET_NAMES.map(name => env?.[name])
  if (linkHashKey && rateTicketSecret && linkHashKey === rateTicketSecret)
    throw new Error('拒绝部署：领取链接摘要密钥与速率凭证密钥不能复用')

  return requiredNames
}
