import { resolveSsoClientPresentation } from '~/config/sso-explorer'
import { parseAuthEntry, readableHost } from '~/utils/auth-entry'

/**
 * 登录 / 注册页共用的来路信息：从 ?redirect= 解析出要回到的应用或页面，
 * 供标题、来源横幅和左上角返回按钮使用。
 */
export function useAuthEntry() {
  const route = useRoute()
  const entry = computed(() => parseAuthEntry(route.query.redirect))

  const resolvedClient = computed(() => entry.value.kind === 'sso'
    ? resolveSsoClientPresentation(entry.value.clientId, entry.value.redirectUri)
    : null)

  /** 来源可信：客户端已注册且回调地址与注册表完全一致 */
  const ssoVerified = computed(() => resolvedClient.value?.verified === true)

  /** 只在来源可信时借用应用名称与图标，避免伪造的回调地址冒用正规应用的品牌 */
  const ssoClient = computed(() => ssoVerified.value ? resolvedClient.value : null)

  const ssoHost = computed(() => entry.value.kind === 'sso' ? readableHost(entry.value.redirectUri) : '')

  const destinationName = computed(() => {
    const value = entry.value
    if (value.kind === 'sso')
      return ssoClient.value?.name ?? (ssoHost.value || '未知应用')
    if (value.kind === 'device')
      return '桌面应用'
    if (value.kind === 'page')
      return value.label
    return null
  })

  /** 只有来源可信时才提供「返回应用」，避免把用户送回伪造的回调地址 */
  const backTarget = computed(() => {
    const value = entry.value
    if (value.kind === 'sso' && ssoClient.value) {
      try {
        return { href: new URL(value.redirectUri).origin, label: `返回 ${ssoClient.value.name}` }
      }
      catch {
        return null
      }
    }
    return null
  })

  return { entry, ssoClient, ssoHost, ssoVerified, destinationName, backTarget }
}
