<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import AppProductIcon from './AppProductIcon.vue'

defineProps<{
  app: SsoExplorerApp
  active?: boolean
}>()

const emit = defineEmits<{
  activate: [appId: string]
  deactivate: [appId: string]
}>()

function leaveNode(event: MouseEvent, appId: string) {
  if (!(event.currentTarget as HTMLElement).contains(document.activeElement))
    emit('deactivate', appId)
}

function leaveFocus(event: FocusEvent, appId: string) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    emit('deactivate', appId)
}
</script>

<template>
  <div
    class="sso-app-node"
    :class="{ 'sso-app-node--active': active }"
    :style="{ '--sso-app-accent': app.accent }"
    :data-testid="`sso-app-${app.appId}`"
    @mouseenter="emit('activate', app.appId)"
    @mouseleave="leaveNode($event, app.appId)"
    @focusin="emit('activate', app.appId)"
    @focusout="leaveFocus($event, app.appId)"
  >
    <a
      :href="app.origin"
      target="_blank"
      rel="noopener noreferrer"
      class="sso-app-node__link"
    >
      <span class="sso-app-node__identity">
        <AppProductIcon :app="app" class="sso-app-node__logo" />
        <span class="sso-app-node__port" aria-hidden="true" />
      </span>
      <strong>{{ app.name }}</strong>
      <Icon name="i-lucide-arrow-up-right" class="sso-app-node__external" aria-hidden="true" />
      <span class="sr-only">，统一账号，在新标签页打开</span>
    </a>
  </div>
</template>

<style scoped>
.sso-app-node {
  position: relative;
  width: 8.5rem;
  height: 6rem;
  color: var(--ui-text-highlighted);
}

.sso-app-node__link {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  border-radius: 1rem;
  padding: 0.2rem 0.25rem;
  outline: none;
}

.sso-app-node__identity {
  position: relative;
  flex: none;
}

.sso-app-node__identity::before {
  position: absolute;
  inset: -0.45rem;
  border: 1px solid color-mix(in srgb, var(--sso-app-accent) 35%, transparent);
  border-radius: 30%;
  background: color-mix(in srgb, var(--sso-app-accent) 7%, transparent);
  content: '';
  opacity: 0;
  transition: opacity 160ms ease;
}

.sso-app-node__logo {
  --app-icon-size: 3rem;
}

.sso-app-node__port {
  position: absolute;
  left: calc(50% - 0.2rem);
  bottom: -0.2rem;
  width: 0.4rem;
  height: 0.4rem;
  border: 1px solid var(--ui-bg-elevated);
  border-radius: 50%;
  background: var(--sso-app-accent);
}

.sso-app-node__link strong {
  display: -webkit-box;
  overflow: hidden;
  max-width: 100%;
  color: var(--ui-text-highlighted);
  font-size: 0.76rem;
  font-weight: 600;
  line-height: 1.35;
  text-align: center;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.sso-app-node__external {
  position: absolute;
  top: 0;
  right: 1.1rem;
  width: 0.75rem;
  height: 0.75rem;
  color: var(--ui-primary);
  opacity: 0;
  transition: opacity 160ms ease;
}

.sso-app-node--active .sso-app-node__identity::before,
.sso-app-node--active .sso-app-node__external {
  opacity: 1;
}

.sso-app-node--active .sso-app-node__link strong {
  color: var(--ui-primary);
}

.sso-app-node__link:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

@media (min-width: 768px) and (max-width: 1023px) {
  .sso-app-node {
    width: 5.5rem;
    height: 4.5rem;
  }

  .sso-app-node__link {
    gap: 0.45rem;
  }

  .sso-app-node__logo {
    --app-icon-size: 2.5rem;
  }

  .sso-app-node__link strong {
    font-size: 0.68rem;
  }

  .sso-app-node__external {
    right: 0.3rem;
  }
}

@media (min-width: 1024px) {
  .sso-app-node {
    width: 6rem;
    height: 5.25rem;
  }
}

@media (max-width: 639px) {
  .sso-app-node__link strong {
    font-size: 0.7rem;
  }

  .sso-app-node__external {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-app-node__identity::before,
  .sso-app-node__external {
    transition: none;
  }
}
</style>
