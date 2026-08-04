import type { SsoExplorerApp } from '~/types/app-explorer'
import { productionRegistry } from '../../packages/authorization-core/src/registry'

interface SsoPresentation {
  description: string
  fallbackMark: string
  accent: string
  logoUrl?: string
  detailSlug?: string
  position: SsoExplorerApp['position']
}

const presentationByAppId: Record<string, SsoPresentation> = {
  'saier': {
    description: '在线绘画、云端工程与协作房间',
    fallbackMark: '绘',
    accent: 'var(--ylf-dopa-blue)',
    position: { x: 50, y: 91 },
  },
  'cms': {
    description: '安全连接 GitHub 与 Valaxy 的内容编辑平台',
    fallbackMark: 'CMS',
    accent: 'var(--ylf-dopa-blue)',
    position: { x: 24, y: 18 },
  },
  'drive': {
    description: '集中管理和安全复用云端媒体资源',
    fallbackMark: '盘',
    accent: 'var(--ylf-dopa-cyan)',
    position: { x: 14, y: 39 },
  },
  'dayun-kicker': {
    description: '暴力电驴 · 足球小游戏',
    fallbackMark: '球',
    accent: 'var(--ylf-dopa-green)',
    position: { x: 14, y: 63 },
  },
  'ai-sfc': {
    description: 'AI 春联生成',
    fallbackMark: '春',
    accent: 'var(--ylf-dopa-rose)',
    detailSlug: 'ai-sfc',
    position: { x: 24, y: 83 },
  },
  'home': {
    description: '可编辑的云端智能家园',
    fallbackMark: '家',
    accent: '#687b67',
    logoUrl: '/app-icons/home-brand-mark.svg',
    position: { x: 76, y: 18 },
  },
  'wenta': {
    description: '把值得聊一聊的问题认真聊一遍',
    fallbackMark: '问',
    accent: 'var(--ylf-dopa-violet)',
    position: { x: 86, y: 39 },
  },
  'play': {
    description: '汇聚云乐坊小游戏的轻量游戏大厅',
    fallbackMark: '玩',
    accent: 'var(--ylf-dopa-pink)',
    position: { x: 86, y: 63 },
  },
  'smap': {
    description: '规划星际路线与模拟导航行程',
    fallbackMark: '图',
    accent: 'var(--ylf-dopa-cyan)',
    position: { x: 50, y: 9 },
  },
  'fc': {
    description: '在浏览器中重温经典红白机游戏',
    fallbackMark: '游',
    accent: 'var(--ylf-dopa-orange)',
    position: { x: 50, y: 29 },
  },
  'support': {
    description: '统一处理反馈、工单与帮助内容',
    fallbackMark: '助',
    accent: 'var(--ylf-dopa-orange)',
    position: { x: 76, y: 83 },
  },
}

/** 安全控制面可参与 SSO，但不属于面向用户的公开应用探索图谱。 */
const nonDiscoverableSsoClientIds = new Set(['admin-web', 'studio-web'])
const discoverableAppOrder = [
  'saier',
  'cms',
  'drive',
  'dayun-kicker',
  'ai-sfc',
  'home',
  'wenta',
  'play',
  'smap',
  'fc',
  'support',
]
const discoverableAppOrderIndex = new Map(discoverableAppOrder.map((appId, index) => [appId, index]))

function getWebSsoOrigin(client: (typeof productionRegistry.clients)[number]) {
  const adapter = client.adapters.find(candidate => candidate.kind === 'web-sso')
  if (!adapter || !('origins' in adapter) || !adapter.origins)
    return null

  if ('iconUrl' in client && client.iconUrl) {
    const iconOrigin = new URL(client.iconUrl).origin
    const clientOwnedOrigin = adapter.origins.find(origin => origin === iconOrigin)
    if (clientOwnedOrigin)
      return clientOwnedOrigin
  }

  return adapter.origins[0] ?? null
}

export const ssoExplorerApps: SsoExplorerApp[] = productionRegistry.clients.flatMap((client) => {
  if (client.status !== 'active')
    return []
  if (nonDiscoverableSsoClientIds.has(client.clientId))
    return []

  const origin = getWebSsoOrigin(client)
  const iconUrl = 'iconUrl' in client ? client.iconUrl : null
  const presentation = presentationByAppId[client.appId]
  if (!origin)
    return []
  if (!iconUrl || !presentation)
    throw new Error(`Active Web SSO client "${client.clientId}" is missing explorer presentation metadata`)

  return [{
    clientId: client.clientId,
    appId: client.appId,
    name: client.displayName,
    origin,
    description: presentation.description,
    logoUrl: presentation.logoUrl ?? iconUrl,
    fallbackMark: presentation.fallbackMark,
    accent: presentation.accent,
    detailSlug: presentation.detailSlug,
    position: presentation.position,
  }]
}).sort((left, right) =>
  (discoverableAppOrderIndex.get(left.appId) ?? Number.MAX_SAFE_INTEGER)
  - (discoverableAppOrderIndex.get(right.appId) ?? Number.MAX_SAFE_INTEGER),
)

const ssoExplorerSlugs = new Set(
  ssoExplorerApps.flatMap(app =>
    app.detailSlug && app.detailSlug !== app.appId
      ? [app.appId, app.detailSlug]
      : [app.appId],
  ),
)

export function isSsoExplorerAppSlug(slug: string) {
  return ssoExplorerSlugs.has(slug)
}
