import type { InjectionKey, Ref } from 'vue'

export const navigationMenuViewportKey: InjectionKey<Readonly<Ref<boolean>>> = Symbol('navigation-menu-viewport')
