// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ProfileTab from '../../app/components/settings/ProfileTab.vue'

const h = vi.hoisted(() => ({ s: {} as Record<string, unknown> }))

mockNuxtImport('useTcbAuth', () => () => ({
  user: h.s.user,
  fetchUser: h.s.fetchUser,
  setUsername: h.s.setUsername,
}))
mockNuxtImport('useAvatarUpload', () => () => ({ uploadAvatar: h.s.uploadAvatar }))
mockNuxtImport('useCloudbase', () => () => ({ auth: { updateUser: h.s.updateUser } }))
mockNuxtImport('useAppToast', () => () => ({ add: h.s.toastAdd }))

const stubs = {
  AvatarCropper: true,
  Alert: { template: '<aside><slot /></aside>' },
  AlertDescription: { template: '<p><slot /></p>' },
  AlertTitle: { template: '<strong><slot /></strong>' },
  Badge: { template: '<span><slot /></span>' },
  Button: {
    props: ['disabled', 'type'],
    emits: ['click'],
    template: '<button :type="type || \'button\'" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  Dialog: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  DialogClose: { template: '<div><slot /></div>' },
  DialogContent: { template: '<section><slot /></section>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<footer><slot /></footer>' },
  DialogHeader: { template: '<header><slot /></header>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  Field: { template: '<div><slot /></div>' },
  FieldDescription: { template: '<p><slot /></p>' },
  FieldError: { template: '<p><slot /></p>' },
  FieldGroup: { template: '<div><slot /></div>' },
  FieldLabel: { template: '<label><slot /></label>' },
  FieldLegend: { template: '<legend><slot /></legend>' },
  FieldSet: { template: '<fieldset><slot /></fieldset>' },
  InputGroup: { template: '<div><slot /></div>' },
  InputGroupAddon: { template: '<span><slot /></span>' },
  InputGroupInput: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)">',
  },
  MemberAvatar: true,
  Separator: { template: '<hr>' },
  Spinner: true,
  Textarea: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  ToggleGroup: {
    props: ['spacing'],
    template: '<div data-testid="gender-toggle-group" :data-spacing="spacing"><slot /></div>',
  },
  ToggleGroupItem: { template: '<button type="button"><slot /></button>' },
}

describe('settings profile editing entry', () => {
  beforeEach(() => {
    h.s.user = ref({
      id: 'u1',
      login: 'alice',
      nickname: 'Alice',
      avatar: '',
      description: 'Hello',
      gender: '',
    })
    h.s.fetchUser = vi.fn()
    h.s.setUsername = vi.fn()
    h.s.uploadAvatar = vi.fn()
    h.s.updateUser = vi.fn().mockResolvedValue({ error: null })
    h.s.toastAdd = vi.fn()
  })

  it('directly renders the editable form when requested by the entry route', async () => {
    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })

    expect(wrapper.get('form[aria-label="编辑个人资料"]').exists()).toBe(true)
    expect(wrapper.get('fieldset[aria-labelledby="profile-gender-label"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="gender-toggle-group"]').attributes('data-spacing')).toBe('2')
    expect((wrapper.get('input[placeholder="输入您的昵称"]').element as HTMLInputElement).value).toBe('Alice')
    expect(wrapper.text()).toContain('保存')
    expect(wrapper.text()).not.toContain('🔒')
    expect(wrapper.findAll('button').some(button => button.text() === '编辑')).toBe(false)
    expect(wrapper.get('button[aria-label="上传头像"]').exists()).toBe(true)
  })

  it('keeps the read-only overview for a normal settings visit', async () => {
    const wrapper = await mountSuspended(ProfileTab, { global: { stubs } })

    expect(wrapper.find('input[placeholder="输入您的昵称"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.findAll('button').some(button => button.text() === '编辑')).toBe(true)
  })

  it('lets a GitHub user whose numeric placeholder was normalized choose a username', async () => {
    h.s.user.value = {
      ...h.s.user.value,
      login: null,
    }
    const setUsername = h.s.setUsername as ReturnType<typeof vi.fn>
    const wrapper = await mountSuspended(ProfileTab, { global: { stubs } })

    expect(wrapper.text()).toContain('尚未设置')
    const openButton = wrapper.findAll('button').find(button => button.text().includes('设置用户名'))
    expect(openButton).toBeTruthy()
    await openButton!.trigger('click')

    await wrapper.get('input[placeholder="请输入用户名"]').setValue('new_github_user')
    const confirmButton = wrapper.findAll('button').find(button => button.text().includes('确认设置'))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(setUsername).toHaveBeenCalledWith('new_github_user')
  })

  it('normalizes the username and renders CloudBase validation failures inline', async () => {
    h.s.user.value = {
      ...h.s.user.value,
      login: null,
    }
    const setUsername = h.s.setUsername as ReturnType<typeof vi.fn>
    const toastAdd = h.s.toastAdd as ReturnType<typeof vi.fn>
    setUsername.mockRejectedValue(new Error('用户名必须匹配 ^[a-z][0-9a-z_-]{5,24}$'))
    const wrapper = await mountSuspended(ProfileTab, { global: { stubs } })

    const openButton = wrapper.findAll('button').find(button => button.text().includes('设置用户名'))
    await openButton!.trigger('click')

    const input = wrapper.get('input[placeholder="请输入用户名"]')
    await input.setValue('  Yuier1  ')
    expect((input.element as HTMLInputElement).value).toBe('yuier1')

    const confirmButton = wrapper.findAll('button').find(button => button.text().includes('确认设置'))
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(setUsername).toHaveBeenCalledWith('yuier1')
    expect(wrapper.text()).toContain('用户名需为 6-20 个字符，以小写字母开头')
    expect(wrapper.text()).not.toContain('^[a-z][0-9a-z_-]{5,24}$')
    expect(wrapper.find('input[placeholder="请输入用户名"]').exists()).toBe(true)
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ color: 'error' }))
  })

  it('rejects a five-character username while typing instead of submitting it', async () => {
    h.s.user.value = {
      ...h.s.user.value,
      login: null,
    }
    const setUsername = h.s.setUsername as ReturnType<typeof vi.fn>
    const wrapper = await mountSuspended(ProfileTab, { global: { stubs } })

    const openButton = wrapper.findAll('button').find(button => button.text().includes('设置用户名'))
    await openButton!.trigger('click')
    await wrapper.get('input[placeholder="请输入用户名"]').setValue('yuier')

    expect(wrapper.text()).toContain('用户名至少 6 个字符')
    expect(wrapper.findAll('button').find(button => button.text().includes('确认设置'))?.attributes('disabled')).toBeDefined()
    expect(setUsername).not.toHaveBeenCalled()
  })

  it('lets a user replace a system-generated temporary username', async () => {
    h.s.user.value = {
      ...h.s.user.value,
      login: 'tmp_ftddhqtxqnsw',
    }
    const setUsername = h.s.setUsername as ReturnType<typeof vi.fn>
    const wrapper = await mountSuspended(ProfileTab, { global: { stubs } })

    expect(wrapper.text()).toContain('临时')
    const openButton = wrapper.findAll('button').find(button => button.text().includes('修改用户名'))
    expect(openButton).toBeTruthy()
    await openButton!.trigger('click')

    await wrapper.get('input[placeholder="请输入用户名"]').setValue('chosen_username')
    const confirmButton = wrapper.findAll('button').find(button => button.text().includes('确认修改'))
    expect(confirmButton).toBeTruthy()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(setUsername).toHaveBeenCalledWith('chosen_username')
  })

  it('emits completion when the user cancels direct editing', async () => {
    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })

    const cancel = wrapper.findAll('button').find(button => button.text() === '取消')
    expect(cancel).toBeTruthy()
    await cancel!.trigger('click')

    expect(wrapper.emitted('editFinished')).toHaveLength(1)
    expect(wrapper.find('input[placeholder="输入您的昵称"]').exists()).toBe(false)
  })

  it('leaves edit mode when the route request is cleared', async () => {
    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })

    expect(wrapper.find('input[placeholder="输入您的昵称"]').exists()).toBe(true)

    await wrapper.setProps({ startEditing: false })

    expect(wrapper.find('input[placeholder="输入您的昵称"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('个人资料')
  })

  it('keeps avatar editing open when CloudBase rejects the profile update', async () => {
    const uploadAvatar = h.s.uploadAvatar as ReturnType<typeof vi.fn>
    const updateUser = h.s.updateUser as ReturnType<typeof vi.fn>
    const fetchUser = h.s.fetchUser as ReturnType<typeof vi.fn>
    const toastAdd = h.s.toastAdd as ReturnType<typeof vi.fn>

    uploadAvatar.mockResolvedValue({
      fileID: 'cloud://env.bucket/avatars/u1.jpg',
      cloudPath: 'avatars/u1.jpg',
      url: 'https://example.com/avatar.jpg',
    })
    updateUser.mockResolvedValue({ error: new Error('头像保存失败') })

    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })

    wrapper.findComponent({ name: 'AvatarCropper' }).vm.$emit(
      'confirm',
      new File(['avatar'], 'avatar.jpg', { type: 'image/jpeg' }),
    )
    await flushPromises()

    await wrapper.get('form[aria-label="编辑个人资料"]').trigger('submit')
    await flushPromises()

    expect(updateUser).toHaveBeenCalledWith({
      avatar_url: 'cloud://env.bucket/avatars/u1.jpg',
    })
    expect(fetchUser).not.toHaveBeenCalled()
    expect(wrapper.emitted('editFinished')).toBeUndefined()
    expect(wrapper.find('input[placeholder="输入您的昵称"]').exists()).toBe(true)
    expect(toastAdd).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '保存失败',
      color: 'error',
    }))
  })

  it('rejects avatar formats outside the advertised allowlist', async () => {
    const toastAdd = h.s.toastAdd as ReturnType<typeof vi.fn>
    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })
    const input = wrapper.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['<svg />'], 'avatar.svg', { type: 'image/svg+xml' })],
    })

    await input.trigger('change')

    expect(toastAdd).toHaveBeenLastCalledWith({
      title: '格式错误',
      description: '仅支持 JPG、PNG、GIF 或 WebP 图片',
      color: 'error',
    })
    expect(wrapper.findComponent({ name: 'AvatarCropper' }).props('open')).toBe(false)
  })

  it('trims the nickname before saving it', async () => {
    const updateUser = h.s.updateUser as ReturnType<typeof vi.fn>
    const wrapper = await mountSuspended(ProfileTab, {
      props: { startEditing: true },
      global: { stubs },
    })

    await wrapper.get('input[placeholder="输入您的昵称"]').setValue('  Alice Chen  ')
    await wrapper.get('form[aria-label="编辑个人资料"]').trigger('submit')
    await flushPromises()

    expect(updateUser).toHaveBeenCalledWith({
      nickname: 'Alice Chen',
    })
  })
})
