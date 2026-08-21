export interface AiPointAccount {
  initialized: boolean
  availableMicroPoints: number
  reservedMicroPoints: number
  activeReservationCount: number
  lifetimeGrantedMicroPoints: number
  lifetimeChargedMicroPoints: number
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
  schemaVersion: 2
  account: AiPointAccount
}

export interface AiPointTransactionPage {
  schemaVersion: 2
  items: AiPointTransaction[]
  nextCursor: string | null
}
