import { defineNuxtModule } from '@nuxt/kit'

/**
 * SSR manifest 仅为当前渲染内容保留 preload。自动 prefetch 会同时请求登录弹窗、
 * 认证 SDK 等按需资源及其依赖。动态导入和 NuxtLink 的悬停、聚焦预取仍由客户端处理。
 */
export default defineNuxtModule({
  meta: { name: 'lazy-chunk-prefetch' },
  setup(_, nuxt) {
    if (nuxt.options.dev)
      return

    nuxt.hook('build:manifest', (manifest) => {
      for (const chunk of Object.values(manifest))
        chunk.prefetch = false
    })
  },
})
