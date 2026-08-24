<script setup lang="ts">
import type { AppToastColor } from '~/composables/useAppToast'
import {
  BellIcon,
  CheckCircle2Icon,
  CircleXIcon,
  ExternalLinkIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
} from '@lucide/vue'
import {
  ToastClose,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from 'reka-ui'

const { toasts, close, remove } = useAppToast()

const colorClasses: Record<AppToastColor, string> = {
  error: 'border-destructive/35 bg-popover text-foreground',
  info: 'border-info/35 bg-popover text-foreground',
  neutral: 'border-border bg-popover text-foreground',
  success: 'border-success/35 bg-popover text-foreground',
  warning: 'border-warning/35 bg-popover text-foreground',
}

const iconClasses: Record<AppToastColor, string> = {
  error: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
}

const defaultIcons = {
  error: CircleXIcon,
  info: InfoIcon,
  neutral: BellIcon,
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
} satisfies Record<AppToastColor, unknown>

function handleOpenChange(id: string, open: boolean) {
  if (open)
    return

  close(id)
  setTimeout(remove, 200, id)
}
</script>

<template>
  <ToastProvider label="通知" :duration="5000" swipe-direction="right">
    <ToastRoot
      v-for="toast in toasts"
      :key="toast.id"
      :open="toast.open"
      :duration="toast.duration"
      force-mount
      class="pointer-events-auto relative grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 overflow-hidden rounded-2xl border p-4 pr-3 shadow-xl outline-none transition data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full data-[swipe=move]:translate-x-[var(--reka-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--reka-toast-swipe-end-x)]"
      :class="colorClasses[toast.color]"
      @update:open="handleOpenChange(toast.id, $event)"
    >
      <span
        aria-hidden="true"
        class="flex size-9 shrink-0 items-center justify-center rounded-xl"
        :class="iconClasses[toast.color]"
      >
        <Icon v-if="toast.icon" :name="toast.icon" class="size-5" />
        <component :is="defaultIcons[toast.color]" v-else class="size-5" />
      </span>

      <div class="min-w-0 pt-0.5">
        <ToastTitle class="text-sm leading-5 font-semibold">
          {{ toast.title }}
        </ToastTitle>
        <ToastDescription v-if="toast.description" class="mt-1 text-sm leading-5 text-muted-foreground">
          {{ toast.description }}
        </ToastDescription>
        <a
          v-if="toast.action"
          :href="toast.action.href"
          :target="toast.action.target"
          :rel="toast.action.target === '_blank' ? 'noopener noreferrer' : undefined"
          class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {{ toast.action.label }}
          <ExternalLinkIcon v-if="toast.action.target === '_blank'" aria-hidden="true" class="size-3.5" />
        </a>
      </div>

      <ToastClose
        aria-label="关闭通知"
        class="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon class="size-4" />
      </ToastClose>
    </ToastRoot>

    <ToastPortal>
      <ToastViewport
        data-slot="toast-viewport"
        label="通知（{hotkey}）"
        class="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 outline-none sm:top-auto sm:bottom-0 sm:max-w-[26rem]"
      />
    </ToastPortal>
  </ToastProvider>
</template>
