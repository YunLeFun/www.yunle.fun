// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import AccountTab from '../../app/components/settings/AccountTab.vue'

const h = vi.hoisted(() => ({ s: {} as Record<string, any> }))

mockNuxtImport('useTcbAuth', () => () => ({ user: h.s.user, logout: h.s.logout }))
mockNuxtImport('useMembership', () => () => ({
  isActive: ref(false),
  state: ref(null),
  refresh: h.s.refreshMembership,
}))
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.s.callFunction } }))
mockNuxtImport('useAccountAccess', () => () => ({ refresh: h.s.refreshAccountAccess }))
mockNuxtImport('useAppToast', () => () => ({ add: h.s.toastAdd }))

const stubs = {
  MemberBadge: true,
}

describe('settings account deletion state', () => {
  beforeEach(() => {
    h.s.user = ref({ id: 'u1', role: 'USER', createdAt: 1_700_000_000_000 })
    h.s.logout = vi.fn()
    h.s.refreshMembership = vi.fn()
    h.s.refreshAccountAccess = vi.fn()
    h.s.toastAdd = vi.fn()
    h.s.callFunction = vi.fn(async ({ data }: { data: { action: string } }) => {
      if (data.action === 'getAccountDeletionStatus') {
        return {
          result: {
            status: 'pending',
            requestedAt: Date.now() - 1_000,
            scheduledAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            remainingMs: 30 * 24 * 60 * 60 * 1000,
            canCancel: true,
          },
        }
      }
      if (data.action === 'cancelAccountDeletion') {
        return {
          result: { status: 'none', requestedAt: null, scheduledAt: null, remainingMs: 0, canCancel: false },
        }
      }
      throw new Error(`unexpected action: ${data.action}`)
    })
  })

  it('展示 30 天时间线和冻结说明，并引导到专用恢复页', async () => {
    const wrapper = await mountSuspended(AccountTab, { global: { stubs } })
    await flushPromises()
    await nextTick()

    expect(wrapper.text()).toContain('注销冷静期')
    expect(wrapper.text()).toContain('删除账号与认证绑定')
    expect(wrapper.text()).toContain('释放用户名、GitHub、手机和邮箱绑定')
    expect(wrapper.text()).toContain('会员、云币、支付、AI、存储和第三方授权均已冻结')
    expect(wrapper.text()).not.toContain('账号仍可正常使用')

    expect(wrapper.text()).toContain('前往账号状态页')
    expect(wrapper.text()).not.toContain('撤回注销')
    expect(h.s.logout).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('注销完成态不得误显示为正常使用', async () => {
    h.s.callFunction = vi.fn(async () => ({
      result: {
        status: 'completed',
        requestedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
        scheduledAt: null,
        remainingMs: 0,
        canCancel: false,
      },
    }))

    const wrapper = await mountSuspended(AccountTab, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('注销已完成')
    expect(wrapper.text()).not.toContain('正常使用')
    expect(wrapper.text()).not.toContain('申请注销')
    wrapper.unmount()
  })

  it('提交注销后强制刷新统一访问状态，避免状态页命中旧缓存', async () => {
    h.s.callFunction = vi.fn(async ({ data }: { data: { action: string } }) => {
      if (data.action === 'getAccountDeletionStatus') {
        return {
          result: { status: 'none', requestedAt: null, scheduledAt: null, remainingMs: 0, canCancel: false },
        }
      }
      if (data.action === 'requestAccountDeletion') {
        return {
          result: {
            status: 'pending',
            requestedAt: Date.now(),
            scheduledAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
            remainingMs: 30 * 24 * 60 * 60 * 1000,
            canCancel: true,
          },
        }
      }
      throw new Error(`unexpected action: ${data.action}`)
    })
    const wrapper = await mountSuspended(AccountTab, {
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()

    const openDialog = wrapper.findAll('button').find(button => button.text().includes('申请注销'))
    expect(openDialog).toBeTruthy()
    await openDialog!.trigger('click')
    await flushPromises()

    const input = document.querySelector<HTMLInputElement>('#account-delete-confirm')
    expect(input).toBeTruthy()
    await new DOMWrapper(input!).setValue('注销')

    const submit = [...document.querySelectorAll('button')]
      .find(button => button.textContent?.includes('进入 30 天冷静期'))
    expect(submit).toBeTruthy()
    await new DOMWrapper(submit!).trigger('click')
    await flushPromises()

    expect(h.s.refreshAccountAccess).toHaveBeenCalledWith('u1', true)
    wrapper.unmount()
  })
})
