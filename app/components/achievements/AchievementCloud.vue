<script setup lang="ts">
import type { CloudEffect } from '~/types/cloud-achievements'
import CuteCloud from '~/components/CuteCloud.vue'

withDefaults(defineProps<{
  /** The visual variant supplied by the server catalog. */
  effect: CloudEffect
  /** Play once after a deliberate preview action. */
  active?: boolean
}>(), { active: false })
</script>

<template>
  <span class="achievement-cloud" :class="[`achievement-cloud--${effect}`, { 'is-active': active }]" aria-hidden="true">
    <span v-if="effect === 'dawn' || effect === 'sunset'" class="achievement-cloud__sun" />
    <span v-if="effect === 'rainbow'" class="achievement-cloud__rainbow"><i v-for="n in 4" :key="n" :style="{ '--arc': n - 1 }" /></span>
    <span v-if="effect === 'aurora'" class="achievement-cloud__aurora" />
    <span v-if="effect === 'stars'" class="achievement-cloud__stars"><Icon v-for="n in 4" :key="n" name="i-lucide-sparkle" /></span>
    <CuteCloud face class="achievement-cloud__body" :mood="active ? 'happy' : 'calm'" />
    <CuteCloud v-if="effect === 'cotton'" face shape="small" class="achievement-cloud__buddy" />
  </span>
</template>

<style scoped>
.achievement-cloud {
  position: relative;
  display: inline-block;
  width: 100%;
  height: 100%;
  min-height: 54px;
  isolation: isolate;
}
.achievement-cloud__body {
  position: absolute;
  inset: 20% 14% 7%;
  width: 72%;
  height: 73%;
  filter: drop-shadow(0 4px 5px color-mix(in srgb, var(--ylf-palette-blue) 18%, transparent));
}
.achievement-cloud__sun {
  position: absolute;
  top: 9%;
  right: 17%;
  width: 30%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--ylf-palette-sun);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--ylf-palette-sun) 15%, transparent);
}
.achievement-cloud--dawn {
  --ylf-cloud-shade: #f7ca9f;
}
.achievement-cloud--sunset {
  --ylf-cloud-highlight: #ffe1c2;
  --ylf-cloud-shade: #edaaa1;
}
.achievement-cloud--sunset .achievement-cloud__sun {
  background: var(--ylf-palette-coral);
  top: 22%;
  right: 12%;
}
.achievement-cloud__rainbow {
  position: absolute;
  inset: 1% 9% 32%;
}
.achievement-cloud__rainbow i {
  position: absolute;
  inset: calc(var(--arc) * 5px) calc(var(--arc) * 5px) 0;
  border: 4px solid var(--ylf-palette-coral);
  border-bottom: none;
  border-radius: 100px 100px 0 0;
}
.achievement-cloud__rainbow i:nth-child(2) {
  border-color: var(--ylf-palette-sun);
}
.achievement-cloud__rainbow i:nth-child(3) {
  border-color: var(--ylf-palette-green);
}
.achievement-cloud__rainbow i:nth-child(4) {
  border-color: var(--ylf-palette-blue);
}
.achievement-cloud__buddy {
  position: absolute;
  width: 36%;
  height: 40%;
  left: 4%;
  bottom: 0;
}
.achievement-cloud__stars {
  position: absolute;
  inset: 0;
  color: var(--ylf-palette-sun);
}
.achievement-cloud__stars > :nth-child(1) {
  position: absolute;
  left: 5%;
  top: 30%;
  width: 16%;
  height: 22%;
}
.achievement-cloud__stars > :nth-child(2) {
  position: absolute;
  right: 5%;
  top: 45%;
  width: 13%;
  height: 17%;
}
.achievement-cloud__stars > :nth-child(3) {
  position: absolute;
  right: 23%;
  top: 0;
  width: 16%;
  height: 22%;
}
.achievement-cloud__stars > :nth-child(4) {
  position: absolute;
  left: 29%;
  top: 4%;
  width: 10%;
  height: 14%;
}
.achievement-cloud__aurora {
  position: absolute;
  inset: 3% 2% 9%;
  background: linear-gradient(125deg, transparent 10%, #87cbb7 35%, #72b9e9 50%, #afa0e4 65%, transparent 85%);
  border-radius: 50%;
  filter: blur(10px);
  opacity: 0.6;
  transform: rotate(-12deg);
}
.is-active .achievement-cloud__body {
  animation: achievement-cloud-pop 750ms var(--ylf-ease-spring);
}
.is-active .achievement-cloud__sun {
  animation: achievement-sun-peek 1100ms var(--ylf-ease-standard);
}
.is-active .achievement-cloud__rainbow {
  animation: achievement-rainbow 1100ms var(--ylf-ease-standard);
  transform-origin: 50% 100%;
}
.is-active .achievement-cloud__stars {
  animation: achievement-sparkle 1200ms ease;
}
.is-active .achievement-cloud__buddy {
  animation: achievement-cloud-pop 1000ms var(--ylf-ease-spring);
}
.is-active .achievement-cloud__aurora {
  animation: achievement-aurora 1400ms ease;
}
@keyframes achievement-cloud-pop {
  25% {
    scale: 1.08 0.87;
  }
  55% {
    scale: 0.96 1.08;
    translate: 0 -5px;
  }
}
@keyframes achievement-sun-peek {
  from {
    translate: -12px 20px;
  }
  to {
    translate: 0 0;
  }
}
@keyframes achievement-rainbow {
  from {
    scale: 0.7 0.1;
  }
  to {
    scale: 1;
  }
}
@keyframes achievement-sparkle {
  0%,
  50% {
    scale: 0.8;
  }
  25%,
  75% {
    scale: 1.1;
  }
}
@keyframes achievement-aurora {
  from {
    transform: translateX(-12px) rotate(-24deg) scale(0.8);
  }
  to {
    transform: rotate(-12deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .achievement-cloud :deep(*) {
    animation: none !important;
    transition: none !important;
  }
}
</style>
