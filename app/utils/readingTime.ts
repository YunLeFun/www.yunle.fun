interface TextNode {
  type?: string
  value?: string
  children?: TextNode[]
}

function collectText(node: TextNode | undefined, out: string[]) {
  if (!node)
    return
  if (node.type === 'text' && node.value)
    out.push(node.value)
  node.children?.forEach(child => collectText(child, out))
}

/**
 * 估算 MDC 正文的阅读时长（分钟，至少 1 分钟）。
 *
 * 中文按每分钟约 400 字、英文按每分钟约 200 词计算，与常见阅读速度一致。
 */
export function estimateReadingMinutes(body: unknown): number {
  const parts: string[] = []
  collectText(body as TextNode | undefined, parts)
  const text = parts.join(' ')
  const cjk = text.match(/\p{Script=Han}/gu)?.length ?? 0
  const words = text.replace(/\p{Script=Han}/gu, ' ').match(/[a-z0-9]+/gi)?.length ?? 0
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}
