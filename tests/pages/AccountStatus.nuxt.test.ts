import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import AccountStatusPage from '../../app/pages/account-status.vue'

const h = vi.hoisted(() => ({ s: {} as Record<string, any>, navigateTo: vi.fn() }))

mockNuxtImport('useAccountAccess', () => () => ({
  access: h.s.access,
  loading: h.s.loading,
  refresh: h.s.refresh,
  recoverAccount: h.s.recoverAccount,
}))
mockNuxtImport('useTcbAuth', () => () => ({ user: h.s.user, logout: h.s.logout }))
mockNuxtImport('navigateTo', () => h.navigateTo)

const stubs = {
  Alert: { template: '<aside><slot /></aside>' },
  AlertDescription: { template: '<p><slot /></p>' },
  AlertTitle: { template: '<strong><slot /></strong>' },
  Button: {
    props: ['disabled'],
    emits: ['click'],
    template: '<button type="button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  Card: { template: '<section><slot /></section>' },
  CardContent: { template: '<div><slot /></div>' },
  CardDescription: { template: '<p><slot /></p>' },
  CardFooter: { template: '<footer><slot /></footer>' },
  CardHeader: { template: '<header><slot /></header>' },
  CardTitle: { template: '<div><slot /></div>' },
  Dialog: {
    props: ['open'],
    template: '<div v-if="open"><slot /></div>',
  },
  DialogClose: { template: '<div><slot /></div>' },
  DialogContent: { template: '<section><slot /></section>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<footer><slot /></footer>' },
  DialogHeader: { template: '<header><slot /></header>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  NuxtLink: { template: '<a><slot /></a>' },
  Spinner: true,
}

describe('account status page', () => {
  beforeEach(() => {
    registerEndpoint('/api/session', () => ({}))
    h.s.loading = ref(false)
    h.s.user = ref({ id: 'u1' })
    h.s.refresh = vi.fn()
    h.s.recoverAccount = vi.fn(async () => ({ state: 'active', restricted: false }))
    h.s.logout = vi.fn()
    h.navigateTo.mockReset()
  })

  it('待注销用户看到精确截止时间、冻结说明，并可明确恢复', async () => {
    h.s.access = ref({
      state: 'deletion_pending',
      restricted: true,
      recoverable: true,
      requestedAt: Date.UTC(2026, 6, 1, 1),
      scheduledAt: Date.UTC(2026, 6, 31, 1, 30),
    })

    const wrapper = await mountSuspended(AccountStatusPage, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('账号注销冷静期')
    expect(wrapper.text()).toContain('2026年7月31日 09:30')
    expect(wrapper.text()).toContain('中国标准时间（UTC+8）')
    expect(wrapper.text()).toContain('会员、云币、支付、AI、存储和第三方授权均已冻结')

    const recover = wrapper.findAll('button').find(button => button.text().includes('恢复账号'))
    expect(recover).toBeTruthy()
    await recover!.trigger('click')
    await flushPromises()
    expect(h.s.recoverAccount).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('确认恢复账号')

    const confirm = wrapper.findAll('button').find(button => button.text().includes('确认恢复'))
    expect(confirm).toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()
    expect(h.s.recoverAccount).toHaveBeenCalledOnce()
    expect(h.navigateTo).toHaveBeenCalledWith('/')
  })

  it('管理员封禁展示公开原因、期限、案件编号和申诉入口', async () => {
    h.s.access = ref({
      state: 'admin_banned',
      restricted: true,
      recoverable: false,
      publicReason: '违反社区行为规范',
      caseId: 'BAN-20260723-ABC123',
      appealUrl: '/docs/contact?topic=appeal',
      startedAt: Date.UTC(2026, 6, 23, 1),
      expiresAt: Date.UTC(2026, 7, 22, 1),
      permanent: false,
    })

    const wrapper = await mountSuspended(AccountStatusPage, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('账号已被封禁')
    expect(wrapper.text()).toContain('违反社区行为规范')
    expect(wrapper.text()).toContain('BAN-20260723-ABC123')
    expect(wrapper.text()).toContain('2026年8月22日 09:00')
    expect(wrapper.text()).toContain('提交申诉')
    expect(wrapper.text()).not.toContain('恢复账号')
  })

  it('到期清理阶段明确不可恢复', async () => {
    h.s.access = ref({
      state: 'deletion_finalizing',
      restricted: true,
      recoverable: false,
      scheduledAt: Date.UTC(2026, 6, 23, 1),
    })

    const wrapper = await mountSuspended(AccountStatusPage, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('账号正在完成注销')
    expect(wrapper.text()).toContain('已超过可恢复截止时间')
    expect(wrapper.text()).not.toContain('恢复账号')
  })
})
