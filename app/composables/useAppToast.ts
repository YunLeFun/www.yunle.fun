export type AppToastColor = 'error' | 'info' | 'neutral' | 'success' | 'warning'

export interface AppToastAction {
  label: string
  href: string
  target?: '_blank' | '_self'
}

export interface AppToastInput {
  id?: string
  title: string
  description?: string
  icon?: string
  color?: AppToastColor
  duration?: number
  action?: AppToastAction
}

export interface AppToast extends Required<Pick<AppToastInput, 'id' | 'title' | 'color' | 'duration'>> {
  description?: string
  icon?: string
  action?: AppToastAction
  open: boolean
}

const APP_TOAST_LIMIT = 6
const DEFAULT_DURATION = 5000

export function useAppToast() {
  const toasts = useState<AppToast[]>('app-toasts', () => [])
  const sequence = useState<number>('app-toast-sequence', () => 0)

  function add(input: AppToastInput) {
    const id = input.id || `app-toast-${++sequence.value}`
    const toast: AppToast = {
      id,
      title: input.title,
      description: input.description,
      icon: input.icon,
      action: input.action,
      color: input.color || 'neutral',
      duration: input.duration ?? DEFAULT_DURATION,
      open: true,
    }

    toasts.value = [
      ...toasts.value.filter(item => item.id !== id),
      toast,
    ].slice(-APP_TOAST_LIMIT)

    return toast
  }

  function close(id: string) {
    const toast = toasts.value.find(item => item.id === id)
    if (toast)
      toast.open = false
  }

  function remove(id: string) {
    toasts.value = toasts.value.filter(item => item.id !== id)
  }

  function clear() {
    toasts.value = []
  }

  return {
    toasts: readonly(toasts),
    add,
    close,
    remove,
    clear,
  }
}
