/**
 * 挂载后按当地时辰给 <html> 写 data-sky-phase（dawn / day / golden / night），
 * 晴空背景据此叠一层天色（见 main.css「随时辰变化的天色」）。
 * 写在 <html> 上而不是组件里，服务端渲染与首帧都没有这个属性，不会 hydration 不一致；
 * 标签页切回前台时重新判断一次，开着过夜的页面也会跟上天色。
 */
export default defineNuxtPlugin((nuxtApp) => {
  const apply = () => {
    document.documentElement.dataset.skyPhase = getSkyPhase(new Date().getHours())
  }
  nuxtApp.hook('app:mounted', apply)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden)
      apply()
  })
})
