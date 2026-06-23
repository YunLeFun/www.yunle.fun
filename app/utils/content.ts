/**
 * 轻量 Markdown 内容加载（替代 @nuxt/content，见 docs/nuxt-content-removal.md）。
 *
 * content/ 下的 .md 经 Vite `?raw` 导入 + `@nuxtjs/mdc` 的 parseMarkdown 解析渲染，
 * 不依赖 SQL 数据库（better-sqlite3）。内容量很小，eager 全量导入即可。
 */
import type { MDCParserResult } from '@nuxtjs/mdc'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'

type RawMap = Record<string, string>

const docsRaw = import.meta.glob('../../content/1.docs/**/*.md', { query: '?raw', import: 'default', eager: true }) as RawMap
const blogRaw = import.meta.glob('../../content/3.blog/*.md', { query: '?raw', import: 'default', eager: true }) as RawMap
const changelogRaw = import.meta.glob('../../content/4.changelog/*.md', { query: '?raw', import: 'default', eager: true }) as RawMap

export interface MdContent {
  title?: string
  description?: string
  seo?: { title?: string, description?: string }
  date?: string
  image?: { src: string } | string
  authors?: { name: string, to?: string, avatar?: { src: string } }[]
  badge?: { label: string }
  body?: MDCParserResult['body']
  toc?: MDCParserResult['toc']
  path?: string
  [key: string]: unknown
}

/** 去掉文件名 / 目录的数字排序前缀，如 `1.getting-started` → `getting-started` */
function stripNumPrefix(seg: string) {
  return seg.replace(/^\d+\./, '')
}

/** content/1.docs/1.getting-started/1.index.md → /docs/getting-started */
function docsRouteOf(absPath: string) {
  const rel = absPath.replace(/^.*\/content\/1\.docs\//, '').replace(/\.md$/, '')
  const segs = rel.split('/').map(stripNumPrefix)
  if (segs.at(-1) === 'index')
    segs.pop()
  return `/docs/${segs.join('/')}`
}

function slugOf(absPath: string) {
  return stripNumPrefix(absPath.split('/').at(-1)!.replace(/\.md$/, ''))
}

async function parseFlat(raw: string, extra: Record<string, unknown> = {}): Promise<MdContent> {
  const parsed = await parseMarkdown(raw)
  return { ...parsed.data, body: parsed.body, toc: parsed.toc, ...extra }
}

function byDateDesc(a: MdContent, b: MdContent) {
  return new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime()
}

/** 按路由（/docs/...）取文档页 */
export async function getDocPage(routePath: string): Promise<MdContent | null> {
  for (const [abs, raw] of Object.entries(docsRaw)) {
    if (docsRouteOf(abs) === routePath)
      return await parseFlat(raw, { path: routePath })
  }
  return null
}

/** 按 slug 取博客文章 */
export async function getBlogPost(slug: string): Promise<MdContent | null> {
  for (const [abs, raw] of Object.entries(blogRaw)) {
    if (slugOf(abs) === slug)
      return await parseFlat(raw, { path: `/blog/${slug}` })
  }
  return null
}

/** 博客文章列表（按日期倒序） */
export async function getBlogPosts(): Promise<MdContent[]> {
  const list = await Promise.all(
    Object.entries(blogRaw).map(([abs, raw]) => parseFlat(raw, { path: `/blog/${slugOf(abs)}` })),
  )
  return list.sort(byDateDesc)
}

/** 更新日志版本列表（按日期倒序，含正文 body） */
export async function getChangelogVersions(): Promise<MdContent[]> {
  const list = await Promise.all(Object.values(changelogRaw).map(raw => parseFlat(raw)))
  return list.sort(byDateDesc)
}
