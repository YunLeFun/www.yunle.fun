/**
 * 云乐坊 App（apps.yunle.fun）跳转过来支付时的回流辅助。
 *
 * App 端跳转 wallet / pricing 会携带 `?from=apps`，支付成功后展示
 * 「返回云乐坊」按钮：优先关闭当前窗口（App 内 window.open 的标签页 /
 * in-app browser），失败则跳 apps 钱包页（universal link 可拉起 App）。
 */
export function useAppsReturn() {
  const route = useRoute()

  /** 是否从云乐坊 App 跳转而来 */
  const fromApps = computed(() => route.query.from === 'apps')

  function returnToApp() {
    window.close()
    // window.close 仅对脚本打开的窗口生效；失败时退回 apps 钱包页
    setTimeout(() => {
      window.location.href = 'https://apps.yunle.fun/wallet'
    }, 300)
  }

  return { fromApps, returnToApp }
}
