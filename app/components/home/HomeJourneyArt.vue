<script setup lang="ts">
import { ArrowUpRightIcon, CheckIcon, CloudIcon, Gamepad2Icon, LayersIcon, MousePointer2Icon, PaletteIcon, UserRoundIcon } from '@lucide/vue'

defineProps<{
  kind: 'browse' | 'launch' | 'account'
}>()
</script>

<template>
  <div class="journey-art" :class="`journey-art--${kind}`" aria-hidden="true">
    <span class="journey-art__orbit" />

    <div v-if="kind === 'browse'" class="journey-art__window journey-art__catalog">
      <div class="journey-art__chrome">
        <span /><span /><span />
        <i />
      </div>
      <div class="journey-art__apps">
        <span class="journey-art__app journey-art__app--blue"><CloudIcon /></span>
        <span class="journey-art__app journey-art__app--coral"><PaletteIcon /></span>
        <span class="journey-art__app journey-art__app--green"><Gamepad2Icon /></span>
        <span class="journey-art__app journey-art__app--sun"><LayersIcon /></span>
      </div>
      <span class="journey-art__catalog-label"><span /><span /></span>
    </div>

    <template v-else-if="kind === 'launch'">
      <div class="journey-art__window journey-art__launch">
        <div class="journey-art__chrome">
          <span /><span /><span />
          <i />
        </div>
        <div class="journey-art__launch-content">
          <span class="journey-art__launch-logo"><CloudIcon /></span>
          <span class="journey-art__launch-copy"><i /><i /></span>
        </div>
        <span class="journey-art__launch-button"><ArrowUpRightIcon /></span>
      </div>
      <span class="journey-art__click-ring" />
      <MousePointer2Icon class="journey-art__cursor" />
    </template>

    <template v-else>
      <div class="journey-art__pass">
        <span class="journey-art__pass-avatar"><UserRoundIcon /></span>
        <span class="journey-art__pass-copy">云乐坊账号<small>一个账号，随处开始</small></span>
        <span class="journey-art__pass-check"><CheckIcon /></span>
        <CloudIcon class="journey-art__pass-cloud" />
      </div>
      <span class="journey-art__connection" />
      <span class="journey-art__connected journey-art__connected--left"><CloudIcon /></span>
      <span class="journey-art__connected journey-art__connected--right"><LayersIcon /></span>
    </template>
  </div>
</template>

<style scoped>
.journey-art {
  position: relative;
  width: 13.5rem;
  height: 9rem;
  flex: none;
  transform: scale(var(--journey-art-scale, 1));
}

.journey-art__orbit {
  position: absolute;
  width: 11.5rem;
  height: 11.5rem;
  border: 1px solid color-mix(in srgb, var(--step-accent) 12%, transparent);
  border-radius: 50%;
  inset: -1.25rem auto auto 1rem;
}

.journey-art__orbit::after {
  position: absolute;
  border: 1px solid color-mix(in srgb, var(--step-accent) 8%, transparent);
  border-radius: inherit;
  content: '';
  inset: -1.1rem;
}

.journey-art__window {
  position: absolute;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--step-accent) 20%, var(--ui-border-muted));
  border-radius: 0.85rem;
  background: var(--ui-bg-elevated);
  box-shadow:
    0 12px 22px -15px color-mix(in srgb, var(--step-accent) 45%, transparent),
    0 3px 0 color-mix(in srgb, var(--step-accent) 10%, var(--ui-bg-elevated));
}

.journey-art__chrome {
  display: flex;
  height: 1.65rem;
  align-items: center;
  gap: 0.25rem;
  border-bottom: 1px solid var(--ui-border-muted);
  padding-inline: 0.7rem;
}

.journey-art__chrome > span {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 50%;
  background: color-mix(in srgb, var(--step-accent) 30%, var(--ui-border));
}

.journey-art__chrome i {
  width: 3.5rem;
  height: 0.3rem;
  margin-left: 1.35rem;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.journey-art__catalog {
  width: 11.5rem;
  inset: 0.25rem auto auto 1rem;
  transform: rotate(-6deg);
}

.journey-art__apps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.45rem;
  padding: 1rem 0.85rem 0.75rem;
}

.journey-art__app {
  display: grid;
  height: 2.25rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--art-accent) 18%, transparent);
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--art-accent) 8%, var(--ui-bg-elevated));
  color: var(--art-accent);
}

.journey-art__app svg {
  width: 1.1rem;
  height: 1.1rem;
}

.journey-art__app--blue {
  --art-accent: var(--ylf-dopa-blue);
}
.journey-art__app--coral {
  --art-accent: var(--ylf-dopa-orange);
}
.journey-art__app--green {
  --art-accent: var(--ylf-dopa-green);
}
.journey-art__app--sun {
  --art-accent: var(--ylf-dopa-amber);
}

.journey-art__catalog-label {
  display: grid;
  gap: 0.35rem;
  padding: 0 0.85rem 1rem;
}

.journey-art__catalog-label span {
  width: 75%;
  height: 0.3rem;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.journey-art__catalog-label span:last-child {
  width: 45%;
}

.journey-art__launch {
  width: 11.5rem;
  inset: 0.15rem auto auto 0.65rem;
  transform: rotate(5deg);
}

.journey-art__launch-content {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.8rem 0.85rem;
}

.journey-art__launch-logo {
  display: grid;
  width: 2.1rem;
  height: 2.1rem;
  place-items: center;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--step-accent) 10%, var(--ui-bg-elevated));
  color: var(--step-accent);
}

.journey-art__launch-logo svg {
  width: 1.2rem;
  height: 1.2rem;
}

.journey-art__launch-copy {
  display: grid;
  flex: 1;
  gap: 0.4rem;
}

.journey-art__launch-copy i {
  width: 90%;
  height: 0.35rem;
  border-radius: 999px;
  background: var(--ui-bg-accented);
}

.journey-art__launch-copy i:last-child {
  width: 60%;
}

.journey-art__launch-button {
  display: grid;
  height: 1.6rem;
  margin: 0 0.85rem 0.85rem;
  place-items: center;
  border-radius: 0.5rem;
  background: var(--step-accent);
  color: var(--ylf-sso-cloud-top);
}

.journey-art__launch-button svg {
  width: 1rem;
  height: 1rem;
}

.journey-art__click-ring {
  position: absolute;
  width: 2.6rem;
  height: 2.6rem;
  border: 1px solid color-mix(in srgb, var(--step-accent) 30%, transparent);
  border-radius: 50%;
  inset: 5.65rem auto auto 9.65rem;
}

.journey-art__cursor {
  position: absolute;
  width: 2.75rem;
  height: 2.75rem;
  color: var(--ui-text-highlighted);
  fill: var(--ui-bg-elevated);
  filter: drop-shadow(0 3px 2px color-mix(in srgb, var(--ylf-shadow-color) 12%, transparent));
  inset: 6rem auto auto 10rem;
  stroke-width: 1.25;
}

.journey-art__pass {
  position: absolute;
  z-index: 1;
  display: flex;
  width: 11.8rem;
  height: 5.7rem;
  align-items: center;
  gap: 0.6rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-top) 25%, var(--ui-primary));
  border-radius: 0.9rem;
  padding: 0.95rem;
  background: var(--ylf-sso-accent-strong);
  box-shadow: 0 12px 22px -15px color-mix(in srgb, var(--ui-primary) 60%, transparent);
  color: var(--ylf-sso-cloud-top);
  inset: 0.15rem auto auto 0.85rem;
  transform: rotate(-5deg);
}

.journey-art__pass-avatar {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-cloud-top) 25%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ylf-sso-cloud-top) 14%, transparent);
}

.journey-art__pass-avatar svg {
  width: 1.1rem;
  height: 1.1rem;
}

.journey-art__pass-copy {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 0.3rem;
  font-size: 0.7rem;
  font-weight: 600;
}

.journey-art__pass-copy small {
  font-size: 0.5rem;
  font-weight: 400;
  opacity: 0.85;
}

.journey-art__pass-check {
  position: absolute;
  right: 0.7rem;
  bottom: 0.65rem;
  display: grid;
  width: 1rem;
  height: 1rem;
  place-items: center;
  border-radius: 50%;
  background: var(--ylf-sso-cloud-top);
  color: var(--ylf-sso-accent-strong);
}

.journey-art__pass-check svg {
  width: 0.65rem;
  height: 0.65rem;
}

.journey-art__pass-cloud {
  position: absolute;
  right: -0.6rem;
  bottom: -1rem;
  width: 6rem;
  height: 6rem;
  opacity: 0.1;
  stroke-width: 1;
}

.journey-art__connection {
  position: absolute;
  width: 5.4rem;
  height: 2.5rem;
  border: 1px dashed color-mix(in srgb, var(--step-accent) 35%, transparent);
  border-top: none;
  border-radius: 0 0 0.6rem 0.6rem;
  inset: 4rem auto auto 4rem;
}

.journey-art__connected {
  position: absolute;
  z-index: 2;
  display: grid;
  width: 2.35rem;
  height: 2.35rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--step-accent) 20%, var(--ui-border-muted));
  border-radius: 0.75rem;
  background: var(--ui-bg-elevated);
  color: var(--step-accent);
  inset: 6rem auto auto;
}

.journey-art__connected svg {
  width: 1.15rem;
  height: 1.15rem;
}

.journey-art__connected--left {
  left: 2.8rem;
}
.journey-art__connected--right {
  left: 8.2rem;
}
</style>
