export type AiPointAccess = 'none' | 'beta' | (string & {})

export interface AiPointActiveTask {
  taskId: string
  appId: string
  scope: string
  reservedMicroPoints: number
  expiresAt: number
}

export interface AiPointAccount {
  initialized: boolean
  access: AiPointAccess
  availableMicroPoints: number
  reservedMicroPoints: number
  lifetimeGrantedMicroPoints: number
  lifetimeChargedMicroPoints: number
  activeTask: AiPointActiveTask | null
  updatedAt: number | null
}

export interface AiPointTransaction {
  id: string
  type: string
  appId: string
  scope: string
  taskId: string | null
  availableDelta: number
  reservedDelta: number
  chargedMicroPoints: number
  availableAfter: number
  reservedAfter: number
  createdAt: number
}

export interface AiPointAccountResponse {
  schemaVersion: 1
  account: AiPointAccount
}

export interface AiPointTransactionPage {
  schemaVersion: 1
  items: AiPointTransaction[]
  nextCursor: string | null
}
