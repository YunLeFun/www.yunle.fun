<script setup lang="ts">
/**
 * 卡通小云：几团圆鼓鼓的扁平色块拼成，底部一道柔和阴影，可选一张会眨眼的小脸。
 *
 * 比写实的 YlfCloud 更简单、更可爱，用于个人中心等轻松场景。
 * 配色读取 --ylf-cloud-* 主题 token，浅色是白日白云，深色是黄昏的淡紫云。
 * mood="happy" 时眯成 ^ ^ 眼、腮红变深，适合被戳或悬停的瞬间。
 * look 传入 -1~1 的方向时，眼睛朝那边看（跟随指针等）。
 */
const props = withDefaults(defineProps<{
  shape?: 'round' | 'long' | 'small'
  face?: boolean
  mood?: 'calm' | 'happy'
  /** 装饰性眨眼；表单等专注操作的场景可关闭。 */
  animated?: boolean
  /** 视线方向，x / y 取 -1~1 */
  look?: { x: number, y: number }
}>(), {
  shape: 'round',
  face: false,
  mood: 'calm',
  animated: true,
})

interface Bump { cx: number, cy: number, r: number }
interface Silhouette {
  width: number
  height: number
  base: { x: number, y: number, w: number, h: number }
  bumps: Bump[]
  /** 小脸中心 */
  face: { x: number, y: number }
}

const SHAPES: Record<'round' | 'long' | 'small', Silhouette> = {
  round: {
    width: 120,
    height: 72,
    base: { x: 12, y: 40, w: 96, h: 28 },
    bumps: [{ cx: 36, cy: 44, r: 18 }, { cx: 62, cy: 32, r: 24 }, { cx: 88, cy: 44, r: 17 }],
    face: { x: 62, y: 50 },
  },
  long: {
    width: 170,
    height: 64,
    base: { x: 8, y: 36, w: 154, h: 24 },
    bumps: [{ cx: 32, cy: 38, r: 16 }, { cx: 60, cy: 28, r: 21 }, { cx: 94, cy: 24, r: 22 }, { cx: 126, cy: 34, r: 17 }],
    face: { x: 94, y: 44 },
  },
  small: {
    width: 100,
    height: 46,
    base: { x: 6, y: 24, w: 88, h: 18 },
    bumps: [{ cx: 34, cy: 24, r: 13 }, { cx: 60, cy: 20, r: 15 }],
    face: { x: 50, y: 32 },
  },
}

const shapeDef = computed(() => SHAPES[props.shape])
const gaze = computed(() => props.look
  ? `translate(${(Math.max(-1, Math.min(1, props.look.x)) * 2.2).toFixed(2)}px, ${(Math.max(-1, Math.min(1, props.look.y)) * 1.4).toFixed(2)}px)`
  : undefined)
const id = `cute-cloud-${useId()}`
</script>

<template>
  <svg
    class="cute-cloud"
    :class="{ 'cute-cloud--happy': mood === 'happy', 'cute-cloud--still': !animated }"
    :viewBox="`0 0 ${shapeDef.width} ${shapeDef.height}`"
    fill="none"
    focusable="false"
    aria-hidden="true"
  >
    <defs>
      <clipPath :id="`${id}-clip`">
        <rect
          :x="shapeDef.base.x"
          :y="shapeDef.base.y"
          :width="shapeDef.base.w"
          :height="shapeDef.base.h"
          :rx="shapeDef.base.h / 2"
        />
        <circle v-for="(b, i) in shapeDef.bumps" :key="i" :cx="b.cx" :cy="b.cy" :r="b.r" />
      </clipPath>
    </defs>

    <g :clip-path="`url(#${id}-clip)`">
      <rect class="cute-cloud__body" width="100%" height="100%" />
      <!-- 底部一道扁平阴影，让云有一点体积 -->
      <ellipse
        class="cute-cloud__shade"
        :cx="shapeDef.width / 2"
        :cy="shapeDef.base.y + shapeDef.base.h + 2"
        :rx="shapeDef.width * 0.56"
        :ry="shapeDef.base.h * 0.5"
      />
    </g>
    <!-- 左上一道小高光 -->
    <path
      class="cute-cloud__shine"
      :d="`M ${shapeDef.bumps[0]!.cx - shapeDef.bumps[0]!.r * 0.55} ${shapeDef.bumps[0]!.cy - shapeDef.bumps[0]!.r * 0.15} q ${shapeDef.bumps[0]!.r * 0.15} ${-shapeDef.bumps[0]!.r * 0.5} ${shapeDef.bumps[0]!.r * 0.6} ${-shapeDef.bumps[0]!.r * 0.55}`"
    />

    <g v-if="face" class="cute-cloud__face" :transform="`translate(${shapeDef.face.x} ${shapeDef.face.y})`">
      <ellipse class="cute-cloud__blush" cx="-14" cy="4" rx="4.5" ry="2.6" />
      <ellipse class="cute-cloud__blush" cx="14" cy="4" rx="4.5" ry="2.6" />
      <g class="cute-cloud__eyes" :style="{ transform: gaze }">
        <ellipse class="cute-cloud__eye" cx="-7" cy="-1" rx="2.2" ry="2.8" />
        <ellipse class="cute-cloud__eye" cx="7" cy="-1" rx="2.2" ry="2.8" />
      </g>
      <g class="cute-cloud__happy-eyes">
        <path d="M -9.5 0 q 2.5 -4 5 0" />
        <path d="M 4.5 0 q 2.5 -4 5 0" />
      </g>
      <path class="cute-cloud__mouth" d="M -3 3.5 q 3 3 6 0" />
    </g>
  </svg>
</template>

<style scoped>
.cute-cloud {
  --_body: var(--ylf-cloud-highlight, #fffefa);
  --_shade: color-mix(in srgb, var(--ylf-cloud-shade, #c6dff5) 70%, var(--_body));
  --_face: var(--ylf-cloud-face, #5a7fae);

  overflow: visible;
  pointer-events: none;
}

/* 尺寸默认铺满容器；用 :where 降到零优先级，使用处的宽度、定位可以直接覆盖。 */
:where(.cute-cloud) {
  display: block;
  width: 100%;
  height: auto;
}

.cute-cloud__body {
  fill: var(--_body);
}

.cute-cloud__shade {
  fill: var(--_shade);
}

.cute-cloud__shine {
  fill: none;
  stroke: #fff;
  stroke-linecap: round;
  stroke-width: 2.5;
  opacity: 0.9;
}

.cute-cloud__eye {
  fill: var(--_face);
  transform-box: fill-box;
  transform-origin: center;
  animation: cute-cloud-blink 5.2s ease-in-out infinite;
}

.cute-cloud--still .cute-cloud__eye {
  animation: none;
}

.cute-cloud__happy-eyes path,
.cute-cloud__mouth {
  fill: none;
  stroke: var(--_face);
  stroke-linecap: round;
  stroke-width: 1.6;
}

.cute-cloud__blush {
  fill: #ff9fb3;
  opacity: 0.5;
  transition: opacity var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.cute-cloud__happy-eyes {
  opacity: 0;
}

.cute-cloud__eyes {
  transition: transform 180ms var(--ylf-ease-standard);
}

.cute-cloud--happy .cute-cloud__eyes {
  opacity: 0;
}

.cute-cloud--happy .cute-cloud__happy-eyes {
  opacity: 1;
}

.cute-cloud--happy .cute-cloud__blush {
  opacity: 0.85;
}

@keyframes cute-cloud-blink {
  0%,
  92%,
  100% {
    scale: 1 1;
  }
  95% {
    scale: 1 0.1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cute-cloud__eye {
    animation: none;
  }
}
</style>
