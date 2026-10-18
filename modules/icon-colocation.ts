import type { IconifyIcon } from '@iconify/types'
import type { Plugin } from 'vite'
import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { IconUsageScanner, resolveBundleIcons } from '@nuxt/icon/utils'
import { addVitePlugin, defineNuxtModule, resolvePath } from '@nuxt/kit'
import MagicString from 'magic-string'

/** 转出 `@iconify/vue` 的 `addIcon`，解析到与 Nuxt Icon 运行时相同的实例 */
const REGISTER_ID = 'virtual:ylf-icon-register'
const RESOLVED_REGISTER_ID = `\0${REGISTER_ID}`
const REGISTER_FN = '__ylfAddIcon'
/** 只给会被打进客户端模块图的源码注入图标；Markdown 走 `?raw` + 运行时 MDC，没有可注入的模块。 */
const COLOCATED_FILE_RE = /\/(?:app\/.+\.(?:vue|ts|js|mjs)|content\/.+\.ya?ml)$/
/** Markdown 正文与 Nuxt UI Prose 默认图标由渲染 Markdown 的页面携带 */
const RENDERS_MARKDOWN_RE = /<MDCRenderer\b/

/** 用与 Nuxt Icon `clientBundle.scan` 相同的规则找出源码里引用的图标（`prefix:name`）。 */
export function scanIcons(scanner: Pick<IconUsageScanner, 'extractFromCode'>, source: string, shared: ReadonlySet<string>) {
  const icons = new Set<string>()
  scanner.extractFromCode(source, icons)
  return [...icons].filter(icon => !shared.has(icon)).sort()
}

/**
 * 直接在引用方模块顶部注册图标，而不是 import 每个图标各自的副作用模块：
 * Nitro 打包服务端时会摇掉「只有副作用」的 import（见 nitro `moduleSideEffects`），
 * 被多个页面共用、因而拆成独立 chunk 的图标会在 SSR 里丢失；内联也避免了一堆零碎小 chunk。
 */
export function iconRegistrationCode(icons: [name: string, data: IconifyIcon][]) {
  if (!icons.length)
    return ''
  return [
    `import { addIcon as ${REGISTER_FN} } from ${JSON.stringify(REGISTER_ID)};\n`,
    ...icons.map(([name, data]) => `${REGISTER_FN}(${JSON.stringify(name)}, ${JSON.stringify(data)});\n`),
  ].join('')
}

/**
 * Nuxt Icon 的 client bundle 是一整块 JSON，随 `<Icon>` 组件进入全站入口 chunk：
 * 钱包、设置、定价等页面用到的一百多个图标，会让每个首页访客都多下载 ~24KB（gzip）。
 *
 * 这里把扫描范围从「全站一个大包」改成「谁引用谁携带」：源码里写了 `i-lucide-xxx`
 * 的组件 / 配置模块，在构建时于模块顶部用 `addIcon` 注册这些图标的数据。
 * 模块求值先于组件 setup，所以 SSR、水合和客户端导航时图标都已同步可用，不会闪烁；
 * 入口里的组件（AppHeader、app.vue 等）引用的图标仍然留在入口 chunk。
 *
 * Markdown 正文（运行时由 MDC 渲染）里的图标和 Nuxt UI Prose 的默认图标没有可注入的源码模块，
 * 改挂到渲染 `<MDCRenderer>` 的页面上；全局 `icon.clientBundle` 只剩手动列出的 `icons`。
 */
export default defineNuxtModule({
  meta: { name: 'icon-colocation' },
  async setup(_, nuxt) {
    const scanner = new IconUsageScanner({ globInclude: ['app/**/*.{vue,ts,js,mjs}', 'content/**/*.{yml,yaml}'] })
    const iconOptions = nuxt.options.icon || undefined
    const manualIcons = new Set((iconOptions?.clientBundle?.icons ?? []).map(icon => icon.replace(/^i[-:]/, '')))
    // 已在全局 client bundle 里的图标无需重复注册
    let shared = new Set<string>()
    let markdownIcons: string[] = []
    // 本地模块晚于 nuxt.config 里的模块注册，此时 Nuxt UI 已把 Prose 默认图标加进来
    nuxt.hook('icon:clientBundleIcons', (icons) => {
      markdownIcons = [...icons].filter(icon => !manualIcons.has(icon)).sort()
      for (const icon of markdownIcons)
        icons.delete(icon)
      shared = new Set(icons)
    })

    // 与 Nuxt Icon 运行时解析到同一个 `@iconify/vue` 实例，`addIcon` 才会写进 `<Icon>` 读取的那份图标表
    const iconRuntime = join(dirname(await resolvePath('@nuxt/icon')), 'runtime/components/shared.js')
    const resolvePaths = [nuxt.options.rootDir, nuxt.options.workspaceDir]
    async function resolveIconData(icons: string[]) {
      const { collections } = await resolveBundleIcons({ scannedIcons: icons, resolvePaths })
      const data = new Map<string, IconifyIcon>()
      for (const { prefix, icons: entries } of collections) {
        for (const [name, icon] of Object.entries(entries))
          data.set(`${prefix}:${name}`, icon)
      }
      return data
    }
    // 一次性解析整个项目引用到的图标，避免每个模块各读一遍图标集 JSON
    let projectIcons: Promise<Map<string, IconifyIcon>> | undefined
    async function loadIconData(icon: string) {
      projectIcons ||= scanner.scanFiles(nuxt.options.rootDir).then(icons => resolveIconData([...icons, ...markdownIcons]))
      return (await projectIcons).get(icon) ?? (await resolveIconData([icon])).get(icon)
    }

    const plugin: Plugin = {
      name: 'ylf:icon-colocation',
      enforce: 'post',
      async resolveId(id, importer, options) {
        if (id === REGISTER_ID)
          return RESOLVED_REGISTER_ID
        if (id === '@iconify/vue' && importer === RESOLVED_REGISTER_ID)
          return this.resolve(id, iconRuntime, { ...options, skipSelf: true })
      },
      load(id) {
        if (id === RESOLVED_REGISTER_ID)
          return `export { addIcon } from '@iconify/vue'\n`
      },
      async transform(code, id) {
        if (id.includes('?') || id.includes('/node_modules/') || !COLOCATED_FILE_RE.test(id))
          return
        if (relative(nuxt.options.rootDir, id).startsWith('..'))
          return
        // 扫描原始源码而不是编译产物，与 clientBundle.scan 的结果保持一致
        const source = await readFile(id, 'utf8').catch(() => code)
        const icons: [string, IconifyIcon][] = []
        const names = new Set(scanIcons(scanner, source, shared))
        if (RENDERS_MARKDOWN_RE.test(source))
          markdownIcons.forEach(icon => names.add(icon))
        for (const icon of names) {
          // 扫描规则有误报（如 `memory:only`）；解析不到的名字原本也进不了 client bundle
          const data = await loadIconData(icon)
          if (data)
            icons.push([icon, data])
        }
        if (!icons.length)
          return
        const s = new MagicString(code)
        s.prepend(iconRegistrationCode(icons))
        return { code: s.toString(), map: s.generateMap({ hires: 'boundary' }) }
      },
    }
    addVitePlugin(plugin)
  },
})
