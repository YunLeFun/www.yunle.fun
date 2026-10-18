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
