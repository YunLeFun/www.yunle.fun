<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { formFieldIdKey } from '@/utils/formField'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  class?: HTMLAttributes['class']
  disabled?: boolean
  icon?: string
  loading?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  trailingIcon?: string
  ui?: unknown
}>()

const model = defineModel<string | number | null>()
const inputModel = computed<string | number>({
  get: () => model.value ?? '',
  set: value => model.value = value,
})
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
</script>

<template>
  <InputGroup
    v-if="icon || trailingIcon || loading || $slots.leading || $slots.trailing"
    :class="props.class"
  >
    <InputGroupAddon v-if="icon || $slots.leading" align="inline-start">
      <slot name="leading">
        <Icon v-if="icon" :name="icon" />
      </slot>
    </InputGroupAddon>
    <InputGroupInput
      v-bind="$attrs"
      :id="controlId"
      v-model="inputModel"
      :disabled="disabled"
      :aria-describedby="ariaDescribedby"
      :aria-invalid="ariaInvalid"
      :aria-required="ariaRequired"
    />
    <InputGroupAddon v-if="trailingIcon || loading || $slots.trailing" align="inline-end">
      <Spinner v-if="loading" />
      <slot v-else name="trailing">
        <Icon v-if="trailingIcon" :name="trailingIcon" />
      </slot>
    </InputGroupAddon>
  </InputGroup>
  <Input
    v-else
    v-bind="$attrs"
    :id="controlId"
    v-model="inputModel"
    :class="props.class"
    :disabled="disabled"
    :aria-describedby="ariaDescribedby"
    :aria-invalid="ariaInvalid"
    :aria-required="ariaRequired"
  />
</template>
