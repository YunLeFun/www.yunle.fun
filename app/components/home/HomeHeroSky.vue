<script setup lang="ts">
const id = useId()

// A continuous silhouette keeps the cloud soft without visible overlapping circles.
const silhouette = 'M 58 199 C 26 199 8 185 8 164 C 8 144 22 130 43 128 C 39 102 55 81 79 80 C 94 79 106 85 115 94 C 106 57 129 24 164 23 C 191 22 211 38 220 61 C 232 43 251 36 269 40 C 295 45 310 66 309 90 C 325 80 345 83 357 95 C 367 104 371 117 369 129 C 392 119 417 130 424 151 C 449 147 477 163 477 183 C 477 207 453 218 422 218 C 391 218 367 213 341 216 C 303 222 272 218 246 215 C 211 222 176 217 151 212 C 118 218 84 214 58 199 Z'

const clouds = [
  { name: 'distant', duration: '54s', delay: '-18s' },
  { name: 'high', duration: '46s', delay: '-12s' },
  { name: 'main', duration: '42s', delay: '-6s' },
  { name: 'foreground', duration: '58s', delay: '-22s' },
  { name: 'low', duration: '62s', delay: '-30s' },
]
</script>

<template>
  <div class="home-hero-sky" aria-hidden="true">
    <SkyScene clouds="none" :sun="false" />
    <div class="home-hero-sky__atmosphere" />

    <svg
      v-for="cloud in clouds"
      :key="cloud.name"
      class="home-hero-sky__cloud"
      :class="`home-hero-sky__cloud--${cloud.name}`"
      :style="{ animationDuration: cloud.duration, animationDelay: cloud.delay }"
      viewBox="0 0 490 250"
      fill="none"
      focusable="false"
    >
      <defs>
        <linearGradient :id="`${id}-${cloud.name}-body`" x1="210" y1="35" x2="246" y2="222" gradientUnits="userSpaceOnUse">
          <stop stop-color="var(--home-cloud-highlight)" />
          <stop offset="0.46" stop-color="var(--home-cloud-body)" />
          <stop offset="1" stop-color="var(--home-cloud-shade)" />
        </linearGradient>
        <radialGradient :id="`${id}-${cloud.name}-light`" cx="0.3" cy="0.2" r="0.8">
          <stop stop-color="var(--home-cloud-highlight)" stop-opacity="0.9" />
          <stop offset="1" stop-color="var(--home-cloud-highlight)" stop-opacity="0" />
        </radialGradient>
        <radialGradient :id="`${id}-${cloud.name}-shade`" cx="0.5" cy="0.9" r="0.65">
          <stop stop-color="var(--home-cloud-shadow)" stop-opacity="0.34" />
          <stop offset="1" stop-color="var(--home-cloud-shadow)" stop-opacity="0" />
        </radialGradient>
        <clipPath :id="`${id}-${cloud.name}-clip`">
          <path :d="silhouette" />
        </clipPath>
        <filter :id="`${id}-${cloud.name}-soften`" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      <g :clip-path="`url(#${id}-${cloud.name}-clip)`">
        <path :d="silhouette" :fill="`url(#${id}-${cloud.name}-body)`" />
        <ellipse cx="240" cy="181" rx="218" ry="61" :fill="`url(#${id}-${cloud.name}-shade)`" />
        <g :filter="`url(#${id}-${cloud.name}-soften)`">
          <path d="M 63 172 C 84 149 108 164 121 141 C 133 122 119 107 124 83 C 131 40 177 25 204 53 C 229 79 201 113 223 130 C 247 149 277 139 291 162 C 307 188 268 208 218 209 L 80 203 Z" :fill="`url(#${id}-${cloud.name}-light)`" />
          <path d="M 230 174 C 255 163 261 152 257 131 C 252 101 273 83 296 93 C 311 100 312 119 325 128 C 341 138 367 133 374 154 C 383 181 350 199 313 201 L 228 207 Z" :fill="`url(#${id}-${cloud.name}-light)`" opacity="0.56" />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.home-hero-sky {
  --home-cloud-highlight: #fffefa;
  --home-cloud-body: #f2f8ff;
  --home-cloud-shade: #c6dff5;
  --home-cloud-shadow: #83addb;
  position: absolute;
  inset: 0;
  overflow: hidden;
  isolation: isolate;
  pointer-events: none;
}

.home-hero-sky__atmosphere {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 84% 24%, rgb(255 252 236 / 24%), transparent 48%),
    linear-gradient(100deg, rgb(15 55 114 / 44%), rgb(25 76 132 / 12%) 48%, transparent 72%);
}

.home-hero-sky__cloud {
  position: absolute;
  width: var(--cloud-width);
  height: auto;
  overflow: visible;
  opacity: var(--cloud-opacity, 1);
  filter: blur(var(--cloud-softness, 0.5px));
  mask-image: linear-gradient(#000 65%, rgb(0 0 0 / 88%) 77%, transparent 98%);
  transform: translate3d(0, 0, 0) scaleX(var(--cloud-flip, 1));
  animation: home-cloud-drift ease-in-out infinite alternate;
}

.home-hero-sky__cloud--distant {
  --cloud-width: clamp(120px, 14vw, 210px);
  --cloud-opacity: 0.48;
  --cloud-softness: 1.5px;
  top: 8%;
  right: 31%;
}

.home-hero-sky__cloud--high {
  --cloud-width: clamp(170px, 18vw, 270px);
  --cloud-opacity: 0.72;
  --cloud-softness: 0.9px;
  --cloud-flip: -1;
  top: -9%;
  right: -3%;
}

.home-hero-sky__cloud--main {
  --cloud-width: clamp(310px, 35vw, 520px);
  top: 23%;
  right: 2%;
}

.home-hero-sky__cloud--foreground {
  --cloud-width: clamp(480px, 52vw, 780px);
  --cloud-flip: -1;
  --cloud-softness: 0.8px;
  right: -12%;
  bottom: -25%;
}

.home-hero-sky__cloud--low {
  --cloud-width: clamp(300px, 35vw, 520px);
  --cloud-opacity: 0.64;
  --cloud-softness: 1.2px;
  left: -12%;
  bottom: -29%;
}

.dark .home-hero-sky {
  --home-cloud-highlight: #fff0e7;
  --home-cloud-body: #e8d7ed;
  --home-cloud-shade: #b6a5d0;
  --home-cloud-shadow: #8377ad;
}

.dark .home-hero-sky__atmosphere {
  background:
    radial-gradient(ellipse at 84% 24%, rgb(255 198 176 / 14%), transparent 48%),
    linear-gradient(100deg, rgb(24 22 65 / 54%), rgb(46 34 84 / 18%) 48%, transparent 72%);
}

@keyframes home-cloud-drift {
  from {
    transform: translate3d(-10px, 4px, 0) scaleX(var(--cloud-flip, 1));
  }
  to {
    transform: translate3d(12px, -5px, 0) scaleX(var(--cloud-flip, 1));
  }
}

@media (max-width: 767px) {
  .home-hero-sky__cloud--distant {
    top: 1%;
    right: 28%;
  }

  .home-hero-sky__cloud--high {
    top: -5%;
    right: -16%;
  }

  .home-hero-sky__cloud--main {
    --cloud-width: 280px;
    --cloud-opacity: 0.84;
    top: auto;
    right: -22%;
    bottom: -9%;
  }

  .home-hero-sky__cloud--foreground {
    --cloud-width: 400px;
    right: -48%;
    bottom: -23%;
  }

  .home-hero-sky__cloud--low {
    --cloud-width: 260px;
    left: -25%;
    bottom: -23%;
  }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .home-hero-sky__cloud--main {
    --cloud-width: 320px;
    top: auto;
    right: -4%;
    bottom: 6%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-hero-sky__cloud {
    animation: none;
  }

  .home-hero-sky :deep(.ylf-bird) {
    animation: none;
  }
}
</style>
