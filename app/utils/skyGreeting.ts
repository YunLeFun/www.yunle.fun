export interface SkyGreeting {
  text: string
  icon: string
}

/**
 * 按当地时间给出与晴空主题呼应的问候语：清晨日出、白天晴空、傍晚落日、深夜星月。
 */
export function getSkyGreeting(hour: number): SkyGreeting {
  if (hour >= 5 && hour < 11)
    return { text: '早上好', icon: 'i-lucide-sunrise' }
  if (hour >= 11 && hour < 14)
    return { text: '中午好', icon: 'i-lucide-sun' }
  if (hour >= 14 && hour < 18)
    return { text: '下午好', icon: 'i-lucide-cloud-sun' }
  if (hour >= 18 && hour < 23)
    return { text: '晚上好', icon: 'i-lucide-sunset' }
  return { text: '夜深了，早点休息', icon: 'i-lucide-moon-star' }
}

export type SkyPhase = 'dawn' | 'day' | 'golden' | 'night'

/**
 * 按当地时间给出天色：清晨粉霞 5–8 时、白日晴空、午后金光 16–19 时、入夜星空 19–5 时。
 * 只叠加在明暗模式的底色之上，不替用户切换明暗。
 */
export function getSkyPhase(hour: number): SkyPhase {
  if (hour >= 5 && hour < 8)
    return 'dawn'
  if (hour >= 8 && hour < 16)
    return 'day'
  if (hour >= 16 && hour < 19)
    return 'golden'
  return 'night'
}
