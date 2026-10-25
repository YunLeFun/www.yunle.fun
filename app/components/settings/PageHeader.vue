<script setup lang="ts">
defineProps<{
  title: string
  description: string
  security?: boolean
}>()
</script>

<template>
  <header class="settings-header" :class="{ 'settings-header--security': security }">
    <div class="settings-header__copy">
      <h1 class="settings-header__title">
        {{ title }}
      </h1>
      <p class="settings-header__description">
        {{ description }}
      </p>
      <slot />
    </div>
    <SettingsPaperCloud class="settings-header__art" :security="security" />
  </header>
</template>

<style scoped>
.settings-header {
  position: relative;
  isolation: isolate;
  display: flex;
  align-items: center;
  min-height: 12.75rem;
  overflow: hidden;
  padding: 1.875rem;
  border-radius: var(--ylf-radius-xl);
  background: var(--ylf-c-brand-soft);
}
.settings-header__copy {
  position: relative;
  z-index: 1;
  max-width: calc(100% - 14rem);
}
.settings-header__title {
  font-family: var(--ylf-font-heading);
  font-size: 1.5625rem;
  font-weight: 700;
  line-height: 1.4;
}
.settings-header__description {
  margin-top: 0.5rem;
  color: var(--ylf-c-text-2);
  font-size: 0.875rem;
  line-height: 1.75;
  text-wrap: pretty;
}
.settings-header__art {
  position: absolute;
  right: 0.5rem;
  bottom: 0.25rem;
  width: 18.125rem;
  height: 12rem;
}
@media (max-width: 1100px) {
  .settings-header__copy {
    max-width: calc(100% - 11rem);
  }
  .settings-header__art {
    width: 15rem;
    height: 10rem;
  }
}
@media (max-width: 640px) {
  .settings-header {
    min-height: 10rem;
    padding: 1.5rem;
    align-items: flex-start;
  }
  .settings-header--security {
    min-height: 14rem;
  }
  .settings-header__copy {
    max-width: 100%;
  }
  .settings-header__title {
    font-size: 1.375rem;
  }
  .settings-header__description {
    font-size: 0.8125rem;
  }
  .settings-header__art {
    width: 10.5rem;
    height: 7rem;
    right: 0;
    bottom: 0;
  }
  .settings-header:not(.settings-header--security) .settings-header__art {
    width: 8rem;
    height: 5.25rem;
    opacity: 0.65;
  }
}
</style>
