import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const CLOUDBASE_CLI_PACKAGE = '@cloudbase/cli@3.6.4'
const DEFAULT_CONFIG_FILE = 'cloudbaserc.ci.json'

/**
 * CloudBase CLI 3.6.4 stores a valid project credential and then may fail while
 * listing environments with its unrelated global credential store.
 */
export function isKnownCloudBaseLoginTailFailure(output) {
  const loginSucceeded = /login succeeded\.|登录成功！/.test(output)
  const globalCredentialFailed = /No valid identity information|无有效身份信息/.test(output)
  return loginSucceeded && globalCredentialFailed
}

/** Authenticate the pinned CloudBase CLI and verify the resulting credential. */
export function authenticateCloudBaseCli({
  env = process.env,
  run = runCloudBaseCli,
  logger = console,
} = {}) {
  const apiKey = requiredEnvironmentValue(env, 'CLOUDBASE_API_KEY')
  const envId = requiredEnvironmentValue(env, 'CLOUDBASE_ENV_ID')
  const login = run([
    'login',
    '--cloudbase-api-key',
    apiKey,
    '-e',
    envId,
    '--json',
  ], env)
  const loginOutput = `${login.stdout || ''}\n${login.stderr || ''}`

  if (login.error)
    throw login.error
  if (login.status !== 0 && !isKnownCloudBaseLoginTailFailure(loginOutput)) {
    logger.error(redact(loginOutput, apiKey))
    throw new Error(`CloudBase CLI 登录失败（exit ${login.status ?? 'unknown'}）`)
  }
  if (login.status !== 0)
    logger.warn('CloudBase CLI 已写入有效项目凭据；忽略 3.6.4 的登录后全局凭据检查错误')

  const verification = run(['fn', 'list', '-e', envId, '--json'], env)
  if (verification.error)
    throw verification.error
  if (verification.status !== 0) {
    logger.error(redact(`${verification.stdout || ''}\n${verification.stderr || ''}`, apiKey))
    throw new Error(`CloudBase 项目凭据验证失败（exit ${verification.status ?? 'unknown'}）`)
  }

  logger.info(`CloudBase credential verified for ${envId}`)
}

function runCloudBaseCli(args, env) {
  return spawnSync('pnpm', [
    `--package=${CLOUDBASE_CLI_PACKAGE}`,
    'dlx',
    'tcb',
    '--config-file',
    DEFAULT_CONFIG_FILE,
    ...args,
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
    maxBuffer: 8 * 1024 * 1024,
  })
}

function requiredEnvironmentValue(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`缺少 CloudBase CI 环境变量：${name}`)
  return value
}

function redact(output, secret) {
  return secret ? output.split(secret).join('[REDACTED]') : output
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    authenticateCloudBaseCli()
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
