<script setup lang="ts">
import type { CSSProperties } from 'vue'

/**
 * 梦幻晴空背景 —— 天气之子 / 云之彼端 风格。
 *
 * CSS 绘制：晴空渐变天空 + 阳光光晕 + 丁达尔光束 + 蓬松积云 + 飞鸟。
 * 移植自设计稿 dreamy.jsx 的 SkyScene。填充到 position:relative;overflow:hidden 的父容器。
 *
 * - light：晴朗白日；dark：新海诚式黄昏暮色。
 */
interface CloudConf {
  w: number
  top?: string
  left?: string
  right?: string
  bottom?: string
  op: number
  blur: number
  dur: number
  dir: number
  z: number
}

const props = withDefaults(defineProps<{
  theme?: 'light' | 'dark'
  /** 是否显示太阳与丁达尔光束（默认关闭，背景更干净） */
  sun?: boolean
  sunX?: string
  sunY?: string
  clouds?: 'full' | 'mini' | 'none'
}>(), {
  sun: false,
  sunX: '80%',
  sunY: '20%',
  clouds: 'full',
})

const rays = [-18, 6, 26, 44]

const fullClouds: CloudConf[] = [
  { w: 260, top: '14%', left: '-4%', dur: 120, dir: 1, op: 0.9, blur: 0.5, z: 2 },
  { w: 150, top: '8%', right: '14%', dur: 150, dir: -1, op: 0.8, blur: 1.2, z: 1 },
  { w: 320, bottom: '-8%', left: '6%', dur: 140, dir: 1, op: 0.98, blur: 0, z: 3 },
  { w: 230, bottom: '-6%', right: '-4%', dur: 110, dir: -1, op: 0.96, blur: 0, z: 3 },
  { w: 120, top: '38%', left: '34%', dur: 90, dir: 1, op: 0.7, blur: 1.6, z: 1 },
]
const miniClouds: CloudConf[] = [
  { w: 110, bottom: '-14%', left: '-8%', dur: 120, dir: 1, op: 0.95, blur: 0, z: 3 },
  { w: 76, top: '12%', right: '4%', dur: 140, dir: -1, op: 0.8, blur: 0.6, z: 2 },
]
const cloudList = computed(() => (props.clouds === 'full' ? fullClouds : props.clouds === 'mini' ? miniClouds : []))

const birds = [
  { top: '26%', left: '40%', size: 22 },
  { top: '30%', left: '47%', size: 16 },
  { top: '22%', left: '55%', size: 13 },
]

/** 单个云朵由若干叠加的柔和圆形拼出 */
function circ(s: number, l: number, b: number): CSSProperties {
  return {
    position: 'absolute',
    width: `${s}%`,
    paddingBottom: `${s}%`,
    left: `${l}%`,
    bottom: `${b}%`,
    borderRadius: '50%',
    background: 'radial-gradient(circle at 40% 34%, #fff, var(--ylf-sky-scene-cloud-tint) 78%)',
  }
}
</script>

<template>
  <div
    class="ylf-skyscene"
    :data-theme="theme"
    aria-hidden="true"
  >
    <!-- 阳光光晕 + 丁达尔光束（默认关闭，可按需开启 sun） -->
    <template v-if="sun">
      <div :style="{ position: 'absolute', left: sunX, top: sunY, width: '360px', height: '360px', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'radial-gradient(circle, var(--ylf-sky-scene-sun-glow) 0%, transparent 62%)', filter: 'blur(6px)' }" />
      <div :style="{ position: 'absolute', left: sunX, top: sunY, width: '96px', height: '96px', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'radial-gradient(circle, var(--ylf-sky-scene-sun-core) 0%, var(--ylf-sky-scene-sun-glow) 55%, transparent 72%)', boxShadow: '0 0 60px 20px var(--ylf-sky-scene-sun-glow)' }" />
      <div
        v-for="(rot, i) in rays"
        :key="`ray-${i}`"
        class="ylf-ray"
        :style="{
          position: 'absolute',
          left: sunX,
          top: sunY,
          width: '120px',
          height: '620px',
          transform: `translateX(-50%) rotate(${rot}deg)`,
          transformOrigin: 'top center',
          background: 'linear-gradient(color-mix(in srgb, var(--ylf-sky-scene-ray) 50%, transparent), transparent)',
          clipPath: 'polygon(42% 0, 58% 0, 96% 100%, 4% 100%)',
          filter: 'blur(7px)',
          animationDuration: `${7 + i}s`,
          animationDelay: `${i * 0.6}s`,
          mixBlendMode: 'screen',
        }"
      />
    </template>

    <!-- 蓬松积云 -->
    <div
      v-for="(c, i) in cloudList"
      :key="`cloud-${i}`"
      :style="{
        position: 'absolute',
        top: c.top,
        left: c.left,
        right: c.right,
        bottom: c.bottom,
        width: `${c.w}px`,
        height: `${c.w * 0.5}px`,
        opacity: c.op,
        zIndex: c.z,
        filter: c.blur ? `blur(${c.blur}px)` : 'none',
        willChange: 'transform',
        animation: `${c.dir > 0 ? 'ylf-drift' : 'ylf-drift-slow'} ${c.dur}s ease-in-out infinite alternate`,
      }"
    >
      <div :style="{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 9px 11px var(--ylf-sky-scene-cloud-shade))' }">
        <div :style="{ position: 'absolute', left: '4%', right: '4%', bottom: 0, height: '42%', borderRadius: '999px', background: 'linear-gradient(#fff, var(--ylf-sky-scene-cloud-tint))' }" />
        <div :style="circ(46, 2, 4)" />
        <div :style="circ(42, 58, 2)" />
        <div :style="circ(58, 24, 14)" />
        <div :style="circ(42, 50, 24)" />
      </div>
    </div>

    <!-- 飞鸟 -->
    <svg
      v-for="(b, i) in birds"
      :key="`bird-${i}`"
      class="ylf-bird"
      :width="b.size"
      :height="b.size * 0.45"
      viewBox="0 0 22 10"
      :style="{ 'position': 'absolute', 'top': b.top, 'left': b.left, '--rot': '0deg', 'zIndex': 3 }"
      fill="none"
      stroke="var(--ylf-sky-scene-bird)"
      stroke-width="1.4"
      stroke-linecap="round"
    >
      <path d="M1 8 Q5.5 1 11 6 Q16.5 1 21 8" />
    </svg>
  </div>
</template>

<style scoped>
/* 自成层叠上下文：内部云朵/光束的 z-index 不会盖到使用处的兄弟内容上 */
.ylf-skyscene {
  position: absolute;
  overflow: hidden;
  isolation: isolate;
  background: var(--ylf-sky-scene-background);
  inset: 0;
  --ylf-sky-scene-background: linear-gradient(175deg, #2f82e0 0%, #5aa6ea 30%, #9fd2f5 58%, #dceefb 80%, #fdf0d8 100%);
  --ylf-sky-scene-sun-core: #fffbe8;
  --ylf-sky-scene-sun-glow: rgba(255, 249, 222, 0.95);
  --ylf-sky-scene-cloud-tint: #d8e9fa;
  --ylf-sky-scene-cloud-shade: rgba(86, 128, 190, 0.26);
  --ylf-sky-scene-ray: rgb(255, 252, 235);
  --ylf-sky-scene-bird: rgba(40, 55, 95, 0.5);
}

:global(.dark) .ylf-skyscene:not([data-theme]),
.ylf-skyscene[data-theme='dark'] {
  --ylf-sky-scene-background: linear-gradient(175deg, #33386f 0%, #6a5d9c 27%, #c77fa6 52%, #f2a07f 75%, #ffd9a0 100%);
  --ylf-sky-scene-sun-core: #ffdca0;
  --ylf-sky-scene-sun-glow: rgba(255, 196, 138, 0.95);
  --ylf-sky-scene-cloud-tint: #f0c4d4;
  --ylf-sky-scene-cloud-shade: rgba(86, 52, 100, 0.32);
  --ylf-sky-scene-ray: rgb(255, 220, 170);
  --ylf-sky-scene-bird: rgba(60, 40, 70, 0.55);
}

.ylf-skyscene[data-theme='light'] {
  --ylf-sky-scene-background: linear-gradient(175deg, #2f82e0 0%, #5aa6ea 30%, #9fd2f5 58%, #dceefb 80%, #fdf0d8 100%);
  --ylf-sky-scene-sun-core: #fffbe8;
  --ylf-sky-scene-sun-glow: rgba(255, 249, 222, 0.95);
  --ylf-sky-scene-cloud-tint: #d8e9fa;
  --ylf-sky-scene-cloud-shade: rgba(86, 128, 190, 0.26);
  --ylf-sky-scene-ray: rgb(255, 252, 235);
  --ylf-sky-scene-bird: rgba(40, 55, 95, 0.5);
}
</style>
