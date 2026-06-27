// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import OnboardingModal from '../../app/components/OnboardingModal.vue'

// 可变 mock 容器：mockNuxtImport 工厂在组件 setup 时读取，beforeEach 里填充
const h = vi.hoisted(() => ({ s: {} as Record<string, any> }))

mockNuxtImport('useTcbAuth', () => () => ({
  user: h.s.user,
  needsOnboarding: h.s.needsOnboarding,
  fetchUser: h.s.fetchUser,
}))
mockNuxtImport('useUserProfile', () => () => ({ upsertMyProfile: h.s.upsertMyProfile }))
mockNuxtImport('useCloudbase', () => () => ({ auth: { updateUser: h.s.updateUser }, app: {} }))
mockNuxtImport('useToast', () => () => ({ add: h.s.toastAdd }))

function bodyText() {
  return document.body.textContent || ''
}
function queryAll<T extends Element>(sel: string): T[] {
  return Array.from(document.querySelectorAll<T>(sel))
}

describe('onboardingModal', () => {
  beforeEach(() => {
    // 模拟「已被 useAuthCore 写回默认名」后的用户态：昵称已是 云游者_xxx，置位 needsOnboarding
    h.s.user = ref({ id: 'u-test-1', nickname: '云游者_abcd', avatar: null })
    h.s.needsOnboarding = ref(true)
    h.s.fetchUser = vi.fn().mockResolvedValue(undefined)
    h.s.updateUser = vi.fn().mockResolvedValue({})
    h.s.upsertMyProfile = vi.fn().mockResolvedValue({})
    h.s.toastAdd = vi.fn()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('needsOnboarding=true 且未引导过 → 弹层弹出', async () => {
    await mountSuspended(OnboardingModal)
    await flushPromises()
    await nextTick()
    expect(bodyText()).toContain('欢迎来到云乐坊')
  })

  it('该 uid 已在 localStorage 标记过 → 不再弹（防重）', async () => {
    localStorage.setItem('ylf_onboarded_u-test-1', String(1))
    await mountSuspended(OnboardingModal)
    await flushPromises()
    await nextTick()
    expect(bodyText()).not.toContain('欢迎来到云乐坊')
  })

  it('needsOnboarding=false → 不弹', async () => {
    h.s.needsOnboarding = ref(false)
    await mountSuspended(OnboardingModal)
    await flushPromises()
    await nextTick()
    expect(bodyText()).not.toContain('欢迎来到云乐坊')
  })

  it('改昵称后点「完成」→ updateUser 带新昵称、写 profiles、标记 localStorage、关闭', async () => {
    await mountSuspended(OnboardingModal)
    await flushPromises()
    await nextTick()

    // 编辑昵称输入框
    const input = queryAll<HTMLInputElement>('input').find(el => el.type !== 'file')
    expect(input, '应渲染昵称输入框').toBeTruthy()
    input!.value = '我的新昵称'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    // 点「完成」按钮
    const finishBtn = queryAll<HTMLButtonElement>('button').find(b => (b.textContent || '').includes('完成'))
    expect(finishBtn, '应有「完成」按钮').toBeTruthy()
    finishBtn!.click()
    await flushPromises()

    expect(h.s.updateUser).toHaveBeenCalledWith(expect.objectContaining({ nickname: '我的新昵称' }))
    expect(h.s.upsertMyProfile).toHaveBeenCalled()
    expect(localStorage.getItem('ylf_onboarded_u-test-1')).toBeTruthy()
    expect(bodyText()).not.toContain('欢迎来到云乐坊')
  })

  it('「以后再说」→ 不写回、标记 localStorage、关闭', async () => {
    await mountSuspended(OnboardingModal)
    await flushPromises()
    await nextTick()

    const skipBtn = queryAll<HTMLButtonElement>('button').find(b => (b.textContent || '').includes('以后再说'))
    expect(skipBtn, '应有「以后再说」按钮').toBeTruthy()
    skipBtn!.click()
    await flushPromises()

    expect(h.s.updateUser).not.toHaveBeenCalled()
    expect(localStorage.getItem('ylf_onboarded_u-test-1')).toBeTruthy()
    expect(bodyText()).not.toContain('欢迎来到云乐坊')
  })
})
