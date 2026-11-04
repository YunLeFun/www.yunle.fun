// @vitest-environment nuxt
import type { User } from '../app/composables/auth/types'
import type { CloudAchievementCollection } from '../app/types/cloud-achievements'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { clearNuxtState, useState } from '#app'
import Collection from '../app/components/achievements/CloudAchievementCollection.vue'
import { useCloudAchievements } from '../app/composables/useCloudAchievements'
import { isCloudAchievementCollection } from '../app/utils/cloud-achievements'

const h = vi.hoisted(() => ({ callFunction: vi.fn(), toast: vi.fn() }))
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.callFunction } }))
mockNuxtImport('useAppToast', () => () => ({ add: h.toast }))

const first: CloudAchievementCollection = {
  items: [
    { id: 'first-cloud', name: '初见云', description: '初见', effect: 'first', condition: '首次登录', goal: 1, progress: 1, unlockedAt: 100 },
    { id: 'cotton-cloud', name: '棉花云', description: '软绵绵', effect: 'cotton', condition: '戳云 10 次', goal: 10, progress: 5, unlockedAt: null },
  ],
  equippedId: 'first-cloud',
  revision: 1,
}
const account = (id: string): User => ({ id, role: 'USER', hasPassword: true, providers: [], identities: [], createdAt: '', updatedAt: '' })
let client: ReturnType<typeof useCloudAchievements>
const Harness = defineComponent({
  setup() {
    useState<User | null>('auth_user').value = account('alice')
    client = useCloudAchievements()
    return () => null
  },
})

describe('cloud collection client', () => {
  beforeEach(() => {
    clearNuxtState()
    h.callFunction.mockReset().mockResolvedValue({ result: structuredClone(first) })
    h.toast.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('keeps previous equipment on failure and accepts persisted removal after retry', async () => {
    const wrapper = await mountSuspended(Harness)
    expect(await client.refresh()).toBe(true)
    h.callFunction.mockRejectedValueOnce(new Error('网络中断'))
    expect(await client.equip(null)).toBe(false)
    expect(client.collection.value?.equippedId).toBe('first-cloud')
    expect(client.error.value).toBe('佩戴尚未保存，请检查网络后重试')
    h.callFunction.mockResolvedValueOnce({ result: { ...first, equippedId: null, revision: 2 } })
    expect(await client.equip(null)).toBe(true)
    expect(client.collection.value?.equippedId).toBeNull()
    expect(client.error.value).toBeNull()
    wrapper.unmount()
  })

  it('discards an old session response even when the same account returns', async () => {
    const wrapper = await mountSuspended(Harness)
    let resolve!: (result: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(done => resolve = done))
    const pending = client.refresh()
    await flushPromises()
    const user = useState<User | null>('auth_user')
    user.value = account('bob')
    user.value = account('alice')
    resolve({ result: first })
    expect(await pending).toBe(false)
    expect(client.collection.value).toBeNull()
    wrapper.unmount()
  })

  it('drops queued interactions when switching accounts before they are sent', async () => {
    const wrapper = await mountSuspended(Harness)
    let resolve!: (result: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(done => resolve = done))
    const loading = client.refresh()
    await flushPromises()
    const event = client.record({ kind: 'poke' })
    useState<User | null>('auth_user').value = account('bob')
    resolve({ result: first })
    await loading
    expect(await event).toBe(false)
    expect(h.callFunction).toHaveBeenCalledOnce()
    expect(client.collection.value).toBeNull()
    wrapper.unmount()
  })

  it('announces new clouds and submits no local cumulative count or user ID', async () => {
    const wrapper = await mountSuspended(Harness)
    await client.refresh()
    const next = structuredClone(first)
    next.revision = 2
    next.items[1]!.progress = 10
    next.items[1]!.unlockedAt = 200
    h.callFunction.mockResolvedValueOnce({ result: next })
    await client.record({ kind: 'poke' })
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '收集到「棉花云」' }))
    const payload = h.callFunction.mock.lastCall?.[0].data
    expect(payload).toMatchObject({ kind: 'poke', eventId: expect.any(String) })
    expect(payload).not.toHaveProperty('userId')
    expect(payload).not.toHaveProperty('count')
    wrapper.unmount()
  })

  it('rejects malformed successes and respects test identity restrictions', async () => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockResolvedValueOnce({ result: { ok: true } })
    expect(await client.refresh()).toBe(false)
    expect(client.collection.value).toBeNull()
    h.callFunction.mockResolvedValueOnce({ result: { ok: false, code: 'synthetic_action_forbidden', retryable: false } })
    expect(await client.refresh()).toBe(false)
    expect(client.restricted.value).toBe(true)
    const count = h.callFunction.mock.calls.length
    await client.refresh()
    expect(h.callFunction).toHaveBeenCalledTimes(count)
    expect(isCloudAchievementCollection({ ...first, equippedId: 'cotton-cloud' })).toBe(false)
    wrapper.unmount()
  })
})

describe('cloud collection controls', () => {
  it('shows locked progress and only emits equipment changes for collected clouds', async () => {
    const wrapper = await mountSuspended(Collection, { props: { collection: first, editable: true } })
    expect(wrapper.text()).toContain('5 / 10 · 待收集')
    expect(wrapper.findAll('progress')).toHaveLength(1)
    expect(wrapper.findAll('button').some(button => button.text() === '已佩戴' && button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.findAll('button').find(button => button.text() === '摘下')!.trigger('click')
    expect(wrapper.emitted('equip')).toEqual([[null]])
    wrapper.unmount()
  })

  it('renders visitor collections without equipment controls and keeps errors retryable', async () => {
    const wrapper = await mountSuspended(Collection, { props: { collection: { ...first, items: [first.items[0]!] } } })
    expect(wrapper.text()).toContain('正在佩戴')
    expect(wrapper.text()).not.toContain('摘下')
    expect(wrapper.findAll('progress')).toHaveLength(0)
    await wrapper.setProps({ error: '同步失败' })
    await wrapper.findAll('button').find(button => button.text() === '重新同步')!.trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
    wrapper.unmount()
  })
})
