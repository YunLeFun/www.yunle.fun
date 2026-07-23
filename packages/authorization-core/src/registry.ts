import type { ClientRegistrySnapshot } from './index'

function webSso(origin: string) {
  return {
    kind: 'web-sso',
    consent: 'trusted',
    allowedScopes: ['identity:bootstrap'],
    origins: [origin],
    redirectUris: [`${origin}/`],
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
  policyVersion: '2026-07-23.2',
  issuer: 'https://www.yunle.fun',
  clients: [
    {
      clientId: 'cms-web',
      appId: 'cms',
      displayName: 'Yunle CMS',
      status: 'active',
      adapters: [webSso('https://cms.yunle.fun')],
    },
    {
      clientId: 'drive-web',
      appId: 'drive',
      displayName: 'Yunle Drive',
      status: 'active',
      adapters: [webSso('https://drive.yunle.fun')],
    },
    {
      clientId: 'dayun-kicker-web',
      appId: 'dayun-kicker',
      displayName: '大运踢球',
      status: 'active',
      adapters: [webSso('https://dayun-kicker.yunle.fun')],
    },
    {
      clientId: 'home-web',
      appId: 'home',
      displayName: 'Yunle Home',
      status: 'active',
      adapters: [webSso('https://home.yunle.fun')],
    },
    {
      clientId: 'wenta-web',
      appId: 'wenta',
      displayName: '问 TA',
      status: 'active',
      adapters: [webSso('https://wenta.yunle.fun')],
    },
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
  policyVersion: '2026-07-23.2-dev',
  issuer: issuerCatalog.development.issuer,
  clients: [
    {
      clientId: 'cms-web',
      appId: 'cms',
      displayName: 'Yunle CMS',
      status: 'active',
      adapters: [webSso('https://cms.yunle.localhost:3443')],
    },
    {
      clientId: 'drive-web',
      appId: 'drive',
      displayName: 'Yunle Drive',
      status: 'active',
      adapters: [webSso('https://drive.yunle.localhost:3444')],
    },
    {
      clientId: 'dayun-kicker-web',
      appId: 'dayun-kicker',
      displayName: '大运踢球',
      status: 'active',
      adapters: [webSso('https://dayun-kicker.yunle.localhost:3445')],
    },
    {
      clientId: 'home-web',
      appId: 'home',
      displayName: 'Yunle Home',
      status: 'active',
      adapters: [webSso('https://home.yunle.localhost:3446')],
    },
    {
      clientId: 'wenta-web',
      appId: 'wenta',
      displayName: '问 TA',
      status: 'active',
      adapters: [webSso('https://wenta.yunle.localhost:3447')],
    },
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
