<script setup lang="ts">
import type { CloudEffect } from '~/types/cloud-achievements'

defineProps<{
  /** Cosmetic palette and atmospheric accent behind the profile's readable scrim. */
  effect: CloudEffect
}>()
</script>

<template>
  <div class="achievement-sky" :class="`achievement-sky--${effect}`" aria-hidden="true" />
</template>

<style scoped>
.achievement-sky {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.achievement-sky--cotton {
  background: linear-gradient(165deg, #438ac4, #9fd2ef 60%, #ecf5fb);
}
.achievement-sky--rainbow {
  background: linear-gradient(165deg, #4c92cc, #abdcee 70%, #f7eacb);
}
.achievement-sky--dawn {
  background: linear-gradient(160deg, #826ca6, #dd9ba7 50%, #f7ca9f 80%, #ffedc6);
}
.achievement-sky--sunset {
  background: linear-gradient(160deg, #775d96, #bd7b98 45%, #edaaa1 75%, #ffd7a0);
}
.achievement-sky--stars {
  background: linear-gradient(160deg, #20375f, #42558a 60%, #7f8daf);
}
.achievement-sky--aurora {
  background: linear-gradient(160deg, #243c65, #406183 65%, #718ba4);
}
.achievement-sky::after {
  content: '';
  position: absolute;
  inset: 0;
}
.achievement-sky--rainbow::after {
  inset: -30% -5% 0 45%;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at 70% 90%,
    transparent 40%,
    #afa0e460 41% 44%,
    #73b9e960 45% 48%,
    #87cbb760 49% 52%,
    #ffd78260 53% 56%,
    #edaaa160 57% 60%,
    transparent 61%
  );
}
.achievement-sky--stars::after {
  background:
    radial-gradient(2px 2px at 58% 16%, #fff4ce 80%, transparent),
    radial-gradient(1.5px 1.5px at 74% 35%, #fff4ce 80%, transparent),
    radial-gradient(2px 2px at 90% 18%, #fff4ce 80%, transparent),
    radial-gradient(1.5px 1.5px at 46% 40%, #fff4ce 80%, transparent),
    radial-gradient(1px 1px at 82% 62%, #fff4ce 80%, transparent);
}
.achievement-sky--aurora::after {
  inset: -35% -10% 0 25%;
  border-radius: 50%;
  background: linear-gradient(125deg, transparent 20%, #87cbb760 36%, #73b9e970 48%, #afa0e460 60%, transparent 76%);
  filter: blur(18px);
  transform: rotate(-18deg);
}
</style>
