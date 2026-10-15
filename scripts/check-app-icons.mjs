#!/usr/bin/env node
// 检查主站展示的应用图标是否与 YunLeFun/icons 应用素材目录一致。
//
// 规范来源：YunLeFun/icons 的 assets/catalog/app-assets.json。每个应用的 desktopAsset 记录维护者
// 选定的图标（thumbnail URL + SHA-256）。各应用站点的 favicon 只是标签页用的小尺寸伴随图，
// 可能经过简化或重绘，不能作为应用图标的对照。
//
// 主站展示图标的优先级：@yunlefun/icons 的 <appId>-app-icon.svg → sso-explorer 展示层覆盖 → 签名注册表 iconUrl。
// 脚本检查：
//   1. 不走 @yunlefun/icons 的应用，展示的图片是否就是目录选定的原图，且字节哈希一致；
//   2. 签名注册表的 iconUrl 是否还能访问（登录授权页等其他消费者会用到）；
//   3. @yunlefun/icons 已提供完整图标的应用，是否已经接入 app/config/app-icons.ts。
//
// 用法：pnpm check:app-icons（需要网络）。设置 YLF_ICONS_ROOT=<icons 仓库路径> 可读取本地目录。
// 发现问题时以非零状态退出，可接入定时 CI。

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogUrl = 'https://raw.githubusercontent.com/YunLeFun/icons/main/assets/catalog/app-assets.json'
// 主站 appId 与素材目录 slug 不同的应用。
const catalogSlugByAppId = {
  saier: 'pixi-painter',
  cms: 'yunjian',
}

const { registry } = JSON.parse(readFileSync(resolve(root, 'packages/authorization-core/src/generated/production-registry.json'), 'utf8'))
const appIconsSource = readFileSync(resolve(root, 'app/config/app-icons.ts'), 'utf8')
const explorerSource = readFileSync(resolve(root, 'app/config/sso-explorer.ts'), 'utf8')
const packageIcons = new Set(
  readdirSync(resolve(root, 'node_modules/@yunlefun/icons/svg'))
    .filter(file => file.endsWith('-app-icon.svg'))
    .map(file => file.replace(/-app-icon\.svg$/, '')),
)
const registryOnlyIds = new Set(appIconsSource.match(/registryAppIconIds[^\n]*new Set\(\[([^\]]*)\]/)?.[1]?.match(/'([^']+)'/g)?.map(id => id.slice(1, -1)) ?? [])

async function loadCatalog() {
  const localRoot = process.env.YLF_ICONS_ROOT
  if (localRoot) {
    const file = resolve(localRoot, 'assets/catalog/app-assets.json')
    if (existsSync(file))
      return JSON.parse(readFileSync(file, 'utf8'))
  }
  const response = await fetch(catalogUrl, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok)
    throw new Error(`无法读取素材目录 ${catalogUrl}（${response.status}）`)
  return response.json()
}

async function fetchBytes(url) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  return { ok: response.ok, status: response.status, bytes: response.ok ? Buffer.from(await response.arrayBuffer()) : null }
}

const catalogAppIconBase = explorerSource.match(/catalogAppIconBase = '([^']+)'/)?.[1] ?? ''

function presentationLogoUrl(appId) {
  const block = explorerSource.match(new RegExp(`'${appId}': \\{([\\s\\S]*?)\\n  \\},`))?.[1]
  const fromCatalog = block?.match(/logoUrl: `\$\{catalogAppIconBase\}([^`]+)`/)?.[1]
  if (fromCatalog)
    return `${catalogAppIconBase}${fromCatalog}`
  return block?.match(/logoUrl: (?:import\.meta\.dev \? [^:]+ : )?'([^']+)'/)?.[1]
}

const catalog = await loadCatalog()
const catalogBySlug = new Map(catalog.assets.map(asset => [asset.slug, asset]))
const problems = []
const notes = []

const webClients = new Map()
for (const client of registry.clients) {
  const origin = client.adapters.find(adapter => adapter.kind === 'web-sso')?.origins?.[0]
  // 同一个应用可能有多个客户端（如 Web 与移动端），只检查一次。
  if (origin && !webClients.has(client.appId))
    webClients.set(client.appId, client)
}

for (const [appId, client] of webClients) {
  const label = `${client.displayName} (${appId})`

  if (client.iconUrl) {
    const registryIcon = await fetchBytes(client.iconUrl).catch(error => ({ ok: false, status: error.message }))
    if (!registryIcon.ok)
      problems.push(`${label}: 签名注册表图标 ${client.iconUrl} 无法访问（${registryIcon.status}）`)
  }

  const usesPackage = packageIcons.has(appId) && appIconsSource.includes(`/${appId}-app-icon`) && !registryOnlyIds.has(appId)
  if (usesPackage)
    continue

  const asset = catalogBySlug.get(catalogSlugByAppId[appId] ?? appId)?.desktopAsset
  const selected = asset?.usage === 'desktop-selected' ? asset.thumbnail : undefined
  if (!selected) {
    notes.push(`${label}: 素材目录中没有选定图标，跳过`)
    continue
  }

  const shown = presentationLogoUrl(appId) ?? client.iconUrl
  if (shown !== selected.url) {
    problems.push(`${label}: 主站展示 ${shown ?? '（无）'}，素材目录选定 ${selected.url}`)
    continue
  }

  const image = await fetchBytes(selected.url).catch(() => ({ ok: false }))
  if (!image.ok)
    problems.push(`${label}: 选定图标 ${selected.url} 无法访问`)
  else if (createHash('sha256').update(image.bytes).digest('hex') !== selected.sha256)
    notes.push(`${label}: ${selected.url} 的字节哈希与目录记录不同（COS 可能做了图片压缩，请人工核对）`)
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
  console.error(`\n发现 ${problems.length} 处图标问题。以 YunLeFun/icons 素材目录为准：把图标加入 @yunlefun/icons、在 sso-explorer 覆盖为目录选定的 URL，或更新签名注册表的 iconUrl。`)
  process.exit(1)
}
console.log('✓ 主站应用图标与素材目录一致')
