<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formFieldIdKey } from '@/utils/formField'

type SelectItemValue = string | number | Record<string, unknown>

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  class?: HTMLAttributes['class']
  disabled?: boolean
  items: SelectItemValue[]
  labelKey?: string
  placeholder?: string
  valueKey?: string
}>(), {
  labelKey: 'label',
  valueKey: 'value',
})

const model = defineModel<string | number>()
const fieldId = inject(formFieldIdKey, undefined)
const attrs = useAttrs()
const controlId = computed(() => attrs.id as string | undefined || fieldId?.controlId)
const usesFieldContext = computed(() => controlId.value === fieldId?.controlId)
const ariaDescribedby = computed(() => attrs['aria-describedby'] as string | undefined
  || (usesFieldContext.value && fieldId?.hasDescription.value ? fieldId.descriptionId : undefined))
const ariaInvalid = computed(() => attrs['aria-invalid'] as string | boolean | undefined
  ?? (usesFieldContext.value && fieldId?.invalid.value ? true : undefined))
const ariaRequired = computed(() => attrs['aria-required'] as string | boolean | undefined
  ?? (usesFieldContext.value && fieldId?.required.value ? true : undefined))

const normalizedItems = computed(() => props.items.map((item) => {
  if (typeof item === 'string' || typeof item === 'number')
    return { label: String(item), value: item }

  return {
    label: String(item[props.labelKey] ?? item[props.valueKey] ?? ''),
    value: item[props.valueKey] as string | number,
  }
}))
</script>

<template>
  <Select v-model="model" :disabled="disabled">
    <SelectTrigger
      v-bind="$attrs"
      :id="controlId"
      class="w-full"
      :class="props.class"
      :aria-describedby="ariaDescribedby"
      :aria-invalid="ariaInvalid"
      :aria-required="ariaRequired"
    >
      <SelectValue :placeholder="placeholder" />
    </SelectTrigger>
    <SelectContent position="popper">
      <SelectGroup>
        <SelectItem v-for="item in normalizedItems" :key="item.value" :value="item.value">
          {{ item.label }}
        </SelectItem>
      </SelectGroup>
    </SelectContent>
  </Select>
</template>
