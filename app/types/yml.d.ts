// content/*.yml 直接 import 的类型声明（替代 @nuxt/content，见 docs/nuxt-content-removal.md）
declare module '*.yml' {
  const content: any
  export default content
}

declare module '*.yaml' {
  const content: any
  export default content
}
