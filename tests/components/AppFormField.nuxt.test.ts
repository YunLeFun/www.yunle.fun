// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import AppFormField from '../../app/components/AppFormField.vue'
import AppInput from '../../app/components/AppInput.vue'
import AppSelect from '../../app/components/AppSelect.vue'

const TestForm = defineComponent({
  components: { AppFormField, AppInput, AppSelect },
  setup() {
    return {
      area: ref('+86'),
      phone: ref(''),
      areas: [{ label: '+86', value: '+86' }],
    }
  },
  template: `
    <AppFormField
      name="phone"
      label="手机号"
      error="请输入正确的手机号"
      required
    >
      <div>
        <AppSelect
          id="phone-area"
          v-model="area"
          :items="areas"
          aria-label="国家或地区代码"
        />
        <AppInput id="phone" v-model="phone" />
      </div>
    </AppFormField>
  `,
})

describe('appFormField accessibility wiring', () => {
  it('associates the primary control with its label, error and required state', async () => {
    const wrapper = await mountSuspended(TestForm)
    const input = wrapper.get('input#phone')
    const error = wrapper.get('#phone-description')

    expect(wrapper.get('label').attributes('for')).toBe('phone')
    expect(input.attributes('aria-describedby')).toBe('phone-description')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-required')).toBe('true')
    expect(error.attributes('role')).toBe('alert')
    expect(error.text()).toBe('请输入正确的手机号')
  })

  it('keeps a compound select uniquely named without duplicating the field id', async () => {
    const wrapper = await mountSuspended(TestForm)
    const select = wrapper.get('button[role="combobox"]')

    expect(select.attributes('id')).toBe('phone-area')
    expect(select.attributes('aria-label')).toBe('国家或地区代码')
    expect(select.attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.findAll('#phone')).toHaveLength(1)
  })
})
