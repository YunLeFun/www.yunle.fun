<script setup lang="ts">
import { computed, provide, useId, useSlots } from 'vue'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { formFieldIdKey } from '@/utils/formField'

const props = defineProps<{
  error?: string | boolean
  hint?: string
  label?: string
  name?: string
  required?: boolean
}>()

const generatedId = useId()
const labelId = props.name || generatedId
const descriptionId = `${labelId}-description`
const slots = useSlots()
const invalid = computed(() => Boolean(props.error))
const hasDescription = computed(() => invalid.value || Boolean(props.hint || slots.hint))
const required = computed(() => Boolean(props.required))

provide(formFieldIdKey, {
  controlId: labelId,
  descriptionId,
  hasDescription,
  invalid,
  required,
})
</script>

<template>
  <Field :data-invalid="Boolean(error)">
    <FieldLabel v-if="label" :for="labelId">
      {{ label }}<span v-if="required" aria-hidden="true" class="text-destructive"> *</span>
    </FieldLabel>
    <slot :id="labelId" />
    <FieldError v-if="error" :id="descriptionId">
      {{ typeof error === 'string' ? error : '请检查此项' }}
    </FieldError>
    <FieldDescription v-else-if="hint || $slots.hint" :id="descriptionId">
      <slot name="hint">
        {{ hint }}
      </slot>
    </FieldDescription>
  </Field>
</template>
