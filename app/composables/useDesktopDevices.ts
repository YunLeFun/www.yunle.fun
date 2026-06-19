/**
 * 已授权桌面 / 本地应用设备 composable。
 *
 * 对接 desktop-auth 云函数的 listDevices / revokeDevice（均需登录态，SDK callFunction）。
 * 供「设置 → 安全 → 登录设备」展示与吊销已授权设备。
 */

export interface DesktopDevice {
  appId: string
  deviceId: string
  deviceName: string
  createdAt: number
  lastSeenAt: number
}

/** 已知 appId → 展示名（未知则原样回退到 appId） */
const APP_LABELS: Record<string, string> = {
  skykeeper: 'SkyKeeper',
  yunle: '云乐坊',
}

export function desktopAppLabel(appId: string): string {
  return APP_LABELS[appId] || appId
}

export function useDesktopDevices() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  const devices = ref<DesktopDevice[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 拉取当前账号已授权设备（已脱敏，不含 token） */
  async function refresh() {
    if (!user.value || !app) {
      devices.value = []
      return
    }
    loading.value = true
    error.value = null
    try {
      const res = await app.callFunction({ name: 'desktop-auth', data: { action: 'listDevices' } })
      devices.value = (res.result as { devices: DesktopDevice[] }).devices ?? []
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : '获取设备列表失败'
      console.warn('[useDesktopDevices] listDevices failed:', err)
    }
    finally {
      loading.value = false
    }
  }

  /** 吊销指定设备授权；成功后从本地列表移除 */
  async function revoke(appId: string, deviceId: string): Promise<boolean> {
    if (!user.value || !app)
      return false
    const res = await app.callFunction({
      name: 'desktop-auth',
      data: { action: 'revokeDevice', appId, deviceId },
    })
    const ok = !!(res.result as { revoked: boolean })?.revoked
    if (ok)
      devices.value = devices.value.filter(d => !(d.appId === appId && d.deviceId === deviceId))
    return ok
  }

  return { devices, loading, error, refresh, revoke }
}
