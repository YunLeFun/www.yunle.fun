import type { ComputedRef, InjectionKey } from 'vue'

export interface FormFieldContext {
  controlId: string
  descriptionId: string
  hasDescription: ComputedRef<boolean>
  invalid: ComputedRef<boolean>
  required: ComputedRef<boolean>
}

export const formFieldIdKey: InjectionKey<FormFieldContext> = Symbol('form-field-id')
