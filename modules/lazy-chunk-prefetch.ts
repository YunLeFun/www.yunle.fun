import { statSync } from 'node:fs'
import { join } from 'node:path'
import { defineNuxtModule } from '@nuxt/kit'

/** 超过该体积的懒加载 chunk 不再随页面 `<link rel="prefetch">` 空闲预取。 */
const MAX_PREFETCH_CHUNK_BYTES = 100 * 1024
/** Markdown 原文（`?raw`）只在 payload 缺失、需要在浏览器里重新解析时才用到。 */
const RAW_MARKDOWN_RE = /\.md\?raw$/

/**
 * Nuxt 默认为当前页面所有动态导入写入 prefetch 链接。CloudBase SDK（~800KB）、
 * MDC 解析器与插件（~800KB）、Prose 图片缩放动效（motion-v）等大 chunk 只在登录、
 * payload 缺失或正文含图片时才需要，空闲预取会让每个匿名访客在移动网络上白白下载几百 KB。
 * 这里按产物实际体积（以及 Markdown 原文 chunk）关掉预取；真正用到时仍按需加载。
 */
export default defineNuxtModule({
  meta: { name: 'lazy-chunk-prefetch' },
  setup(_, nuxt) {
    if (nuxt.options.dev)
      return

    const clientAssetsDir = join(nuxt.options.buildDir, 'dist/client', nuxt.options.app.buildAssetsDir)
    nuxt.hook('build:manifest', (manifest) => {
      for (const chunk of Object.values(manifest)) {
        if (!chunk.file?.endsWith('.js') || chunk.isEntry)
          continue
        if (chunk.src && RAW_MARKDOWN_RE.test(chunk.src)) {
          chunk.prefetch = false
          continue
        }
        try {
          if (statSync(join(clientAssetsDir, chunk.file)).size > MAX_PREFETCH_CHUNK_BYTES)
            chunk.prefetch = false
        }
        catch {}
      }
    })
  },
})
