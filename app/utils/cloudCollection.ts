/** 每戳一下云朵记一次数，只存在本浏览器里，不上报。 */
export const CLOUD_POKES_KEY = 'ylf:cloud-pokes'
export const CLOUD_MILESTONES = [10, 50, 100] as const

type CloudStorage = Pick<Storage, 'getItem' | 'setItem'>

function storage(): CloudStorage | undefined {
  try {
    return globalThis.localStorage
  }
  catch {
    return undefined
  }
}

export function readCloudPokes(store = storage()): number {
  try {
    const value = Number.parseInt(store?.getItem(CLOUD_POKES_KEY) ?? '', 10)
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  catch {
    return 0
  }
}

export function writeCloudPokes(count: number, store = storage()) {
  try {
    store?.setItem(CLOUD_POKES_KEY, String(count))
  }
  catch {}
}

/** 刚好跨过的收藏里程碑，没有则为 undefined */
export function cloudMilestone(count: number): number | undefined {
  return CLOUD_MILESTONES.find(milestone => milestone === count)
}
