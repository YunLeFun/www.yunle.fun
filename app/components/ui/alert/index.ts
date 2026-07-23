import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertAction } from './AlertAction.vue'
export { default as AlertDescription } from './AlertDescription.vue'
export { default as AlertTitle } from './AlertTitle.vue'

export const alertVariants = cva('grid gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*=size-])]:size-4 group/alert relative w-full', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      destructive: 'border-destructive/35 bg-destructive/10 text-foreground *:data-[slot=alert-description]:text-muted-foreground *:[svg]:text-destructive',
      info: 'border-info/35 bg-info/10 text-foreground *:data-[slot=alert-description]:text-muted-foreground *:[svg]:text-info',
      warning: 'border-warning/35 bg-warning/10 text-foreground *:data-[slot=alert-description]:text-muted-foreground *:[svg]:text-warning',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type AlertVariants = VariantProps<typeof alertVariants>
