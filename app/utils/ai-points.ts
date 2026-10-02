const pointFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 })

export function formatAiPoints(microPoints: number): string {
  return pointFormatter.format(microPoints / 1_000)
}
