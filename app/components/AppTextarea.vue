<script setup lang="ts">
import { Textarea } from '@/components/ui/textarea'
import { formFieldIdKey } from '@/utils/formField'

defineOptions({ inheritAttrs: false })

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
</script>

<template>
  <Textarea
    v-bind="$attrs"
    :id="controlId"
    v-model="model"
    :aria-describedby="ariaDescribedby"
    :aria-invalid="ariaInvalid"
    :aria-required="ariaRequired"
  />
</template>
