import type { ClientRegistrySnapshot } from './registry-types'

function webSso(origin: string) {
  return {
    kind: 'web-sso',
    consent: 'trusted',
    allowedScopes: ['identity:bootstrap'],
    origins: [origin],
    redirectUris: [`${origin}/`],
  } as const
}

function webClient(options: {
  clientId: string
  appId: string
  displayName: string
  origin: string
  iconPath: string
  status?: 'active' | 'disabled'
}) {
  return {
    clientId: options.clientId,
    appId: options.appId,
    displayName: options.displayName,
    iconUrl: new URL(options.iconPath, options.origin).toString(),
    status: options.status ?? 'active',
    adapters: [webSso(options.origin)],
  } as const
}

export const issuerCatalog = {
  production: {
    environment: 'production',
    issuer: 'https://www.yunle.fun',
  },
  development: {
    environment: 'development',
    issuer: 'https://www.yunle.localhost:3000',
  },
} as const

export const productionRegistry = {
  schemaVersion: 1,
  policyVersion: '2026-07-26.3',
  issuer: 'https://www.yunle.fun',
  clients: [
    webClient({
      clientId: 'cms-web',
      appId: 'cms',
      displayName: 'Yunle CMS',
      origin: 'https://cms.yunle.fun',
      iconPath: '/icon.svg',
    }),
    webClient({
      clientId: 'drive-web',
      appId: 'drive',
      displayName: 'Yunle Drive',
      origin: 'https://drive.yunle.fun',
      iconPath: '/drive-mark.svg',
    }),
    webClient({
      clientId: 'dayun-kicker-web',
      appId: 'dayun-kicker',
      displayName: '大运踢球',
      origin: 'https://dayun-kicker.yunle.fun',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'ai-sfc-web',
      appId: 'ai-sfc',
      displayName: 'AI 春联',
      origin: 'https://ai-sfc.yunle.fun',
      iconPath: '/brand/ai-sfc-logo.svg',
    }),
    webClient({
      clientId: 'home-web',
      appId: 'home',
      displayName: 'Yunle Home',
      origin: 'https://home.yunle.fun',
      iconPath: '/favicon.ico',
    }),
    webClient({
      clientId: 'wenta-web',
      appId: 'wenta',
      displayName: '问 TA',
      origin: 'https://wenta.yunle.fun',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'play-web',
      appId: 'play',
      displayName: '云乐坊间',
      origin: 'https://play.yunle.fun',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'support-web',
      appId: 'support',
      displayName: '云乐坊支持中心',
      origin: 'https://support.yunle.fun',
      iconPath: '/favicon.svg',
    }),
    {
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      displayName: 'Skykeeper',
      status: 'active',
      adapters: [
        {
          kind: 'device',
          consent: 'explicit',
          allowedScopes: ['membership:read'],
        },
      ],
    },
  ],
} as const satisfies ClientRegistrySnapshot

export const developmentRegistry = {
  schemaVersion: 1,
  policyVersion: '2026-07-26.3-dev',
  issuer: issuerCatalog.development.issuer,
  clients: [
    webClient({
      clientId: 'cms-web',
      appId: 'cms',
      displayName: 'Yunle CMS',
      origin: 'https://cms.yunle.localhost:3443',
      iconPath: '/icon.svg',
    }),
    webClient({
      clientId: 'drive-web',
      appId: 'drive',
      displayName: 'Yunle Drive',
      origin: 'https://drive.yunle.localhost:3444',
      iconPath: '/drive-mark.svg',
    }),
    webClient({
      clientId: 'dayun-kicker-web',
      appId: 'dayun-kicker',
      displayName: '大运踢球',
      origin: 'https://dayun-kicker.yunle.localhost:3445',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'ai-sfc-web',
      appId: 'ai-sfc',
      displayName: 'AI 春联',
      origin: 'https://ai-sfc.yunle.localhost:3448',
      iconPath: '/brand/ai-sfc-logo.svg',
    }),
    webClient({
      clientId: 'home-web',
      appId: 'home',
      displayName: 'Yunle Home',
      origin: 'https://home.yunle.localhost:3446',
      iconPath: '/favicon.ico',
    }),
    webClient({
      clientId: 'wenta-web',
      appId: 'wenta',
      displayName: '问 TA',
      origin: 'https://wenta.yunle.localhost:3447',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'play-web',
      appId: 'play',
      displayName: '云乐坊间',
      origin: 'https://play.yunle.localhost:3449',
      iconPath: '/favicon.svg',
    }),
    webClient({
      clientId: 'support-web',
      appId: 'support',
      displayName: '云乐坊支持中心',
      origin: 'https://support.yunle.localhost:3450',
      iconPath: '/favicon.svg',
    }),
    {
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      displayName: 'Skykeeper',
      status: 'active',
      adapters: [
        {
          kind: 'device',
          consent: 'explicit',
          allowedScopes: ['membership:read'],
        },
      ],
    },
  ],
} as const satisfies ClientRegistrySnapshot
