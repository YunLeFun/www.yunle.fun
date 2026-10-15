#!/usr/bin/env node
// 检查应用图标是否与各应用线上实际使用的图标一致。
//
// 主站展示图标的优先级：@yunlefun/icons 的 <appId>-app-icon.svg → 展示层覆盖 → 签名注册表 iconUrl。
// 应用自己换了图标文件名时，注册表里的 iconUrl 不会自动跟着变，这个脚本把这类漂移列出来：
//   1. 注册表 iconUrl 是否还能访问；
//   2. 应用首页 <link rel="icon"> 指向的 SVG 是否就是注册表里的 iconUrl；
//   3. @yunlefun/icons 已提供完整图标的应用，是否已经接入 app/config/app-icons.ts。
// 用法：pnpm check:app-icons（需要网络）；发现漂移时以非零状态退出，可接入定时 CI。

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { registry } = JSON.parse(readFileSync(resolve(root, 'packages/authorization-core/src/generated/production-registry.json'), 'utf8'))
const appIconsSource = readFileSync(resolve(root, 'app/config/app-icons.ts'), 'utf8')
const explorerSource = readFileSync(resolve(root, 'app/config/sso-explorer.ts'), 'utf8')
const packageIcons = new Set(
  readdirSync(resolve(root, 'node_modules/@yunlefun/icons/svg'))
    .filter(file => file.endsWith('-app-icon.svg'))
    .map(file => file.replace(/-app-icon\.svg$/, '')),
)

const problems = []
const notes = []

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) })
  return { ok: response.ok, status: response.status, text: response.ok ? await response.text() : '' }
}

function findSvgIcon(html, base) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["'][^"']*\bicon\b/i.test(tag) || /apple-touch-icon/i.test(tag))
      continue
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (href && (/image\/svg\+xml/i.test(tag) || /\.svg(?:$|\?)/i.test(href)))
      return new URL(href, base).href
  }
  return null
}

const webClients = new Map()
for (const client of registry.clients) {
  const origin = client.adapters.find(adapter => adapter.kind === 'web-sso')?.origins?.[0]
  // 同一个应用可能有多个客户端（如 Web 与移动端），只检查一次。
  if (client.iconUrl && origin && !webClients.has(client.appId))
    webClients.set(client.appId, { client, origin })
}

for (const { client, origin } of webClients.values()) {
  const label = `${client.displayName} (${client.appId})`
  const overridden = explorerSource.includes(`'${client.appId}': {`)
    && new RegExp(`'${client.appId}': \\{[^}]*logoUrl:`).test(explorerSource)
  const inPackage = packageIcons.has(client.appId)

  try {
    const icon = await fetchText(client.iconUrl)
    if (!icon.ok)
      problems.push(`${label}: 注册表图标 ${client.iconUrl} 返回 ${icon.status}`)

    const home = await fetchText(origin)
    const liveIcon = home.ok ? findSvgIcon(home.text, origin) : null
    if (liveIcon && liveIcon !== client.iconUrl) {
      const handled = inPackage ? '已由 @yunlefun/icons 覆盖' : overridden ? '已在 sso-explorer 展示层覆盖' : '未处理'
      const line = `${label}: 注册表 ${client.iconUrl} ≠ 线上 ${liveIcon}（${handled}）`
      if (handled === '未处理')
        problems.push(line)
      else
        notes.push(line)
    }
  }
  catch (error) {
    notes.push(`${label}: 无法访问 ${origin}（${error.message}）`)
  }
}

for (const appId of packageIcons) {
  if (webClients.has(appId) && !appIconsSource.includes(`/${appId}-app-icon`))
    problems.push(`${appId}: @yunlefun/icons 已提供 ${appId}-app-icon.svg，但 app/config/app-icons.ts 尚未接入`)
}

for (const line of notes)
  console.log(`ℹ︎ ${line}`)
for (const line of problems)
  console.error(`✗ ${line}`)

if (problems.length) {
  console.error(`\n发现 ${problems.length} 处图标漂移。更新应用的注册表 iconUrl、把图标加入 @yunlefun/icons，或在 sso-explorer 中临时覆盖。`)
  process.exit(1)
}
console.log('✓ 应用图标与线上一致')
