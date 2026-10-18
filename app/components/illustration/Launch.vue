<script setup lang="ts">
/**
 * 「官网上线」插画：一扇浮在云海里的浏览器窗口。
 *
 * 窗口随鼠标轻轻倾斜，里面的小页面在加载、亮起；点一下窗口会撒出一把六色纸屑，
 * 角落的「上线啦」贴纸悬停时会晃一晃。
 */
const PALETTE = [
  'var(--ylf-palette-blue)',
  'var(--ylf-palette-cyan)',
  'var(--ylf-palette-green)',
  'var(--ylf-palette-sun)',
  'var(--ylf-palette-coral)',
  'var(--ylf-palette-pink)',
]

interface Piece { id: number, x: number, y: number, dx: number, dy: number, rot: number, color: string, round: boolean }

const scene = shallowRef<HTMLElement | null>(null)
const pieces = shallowRef<Piece[]>([])
let seed = 0

function celebrate(event: MouseEvent) {
  const box = scene.value?.getBoundingClientRect()
  if (!box)
    return
  const x = event.clientX - box.left
  const y = event.clientY - box.top
  const batch = Array.from({ length: 22 }, (_, index): Piece => {
    const angle = Math.random() * Math.PI * 2
    const speed = 50 + Math.random() * 90
    return {
      id: ++seed,
      x,
      y,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed - 40,
      rot: (Math.random() - 0.5) * 720,
      color: PALETTE[index % PALETTE.length]!,
      round: index % 3 === 0,
    }
  })
  pieces.value = [...pieces.value, ...batch]
  const ids = new Set(batch.map(piece => piece.id))
  setTimeout(() => {
    pieces.value = pieces.value.filter(piece => !ids.has(piece.id))
  }, 1300)
}
</script>

<template>
  <IllustrationFrame>
    <div ref="scene" class="launch">
      <CuteCloud shape="long" class="launch__cloud launch__cloud--back" />
      <CuteCloud shape="small" class="launch__cloud launch__cloud--far" />

      <div class="launch__float">
        <div class="launch__window" @click="celebrate">
          <div class="launch__bar">
            <span class="launch__dot" style="--c: var(--ylf-palette-coral)" />
            <span class="launch__dot" style="--c: var(--ylf-palette-sun)" />
            <span class="launch__dot" style="--c: var(--ylf-palette-green)" />
            <span class="launch__url">
              <span class="launch__lock" />
              www.yunle.fun
            </span>
          </div>
          <div class="launch__page">
            <div class="launch__hero">
              <CuteCloud shape="round" face mood="happy" class="launch__hero-cloud" />
              <span class="launch__line launch__line--title" />
              <span class="launch__line launch__line--sub" />
              <span class="launch__cta" />
            </div>
            <div class="launch__tiles">
              <span v-for="n in 3" :key="n" class="launch__tile" :style="{ '--n': n }" />
            </div>
          </div>
        </div>
        <span class="launch__sticker">上线啦</span>
      </div>

      <CuteCloud shape="round" face class="launch__cloud launch__cloud--front" />

      <span
        v-for="piece in pieces"
        :key="piece.id"
        class="launch__confetti"
        :class="{ 'launch__confetti--round': piece.round }"
        :style="{
          'left': `${piece.x}px`,
          'top': `${piece.y}px`,
          '--dx': `${piece.dx}px`,
          '--dy': `${piece.dy}px`,
          '--rot': `${piece.rot}deg`,
          'background': piece.color,
        }"
      />
    </div>
  </IllustrationFrame>
</template>

<style scoped>
.launch {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}

.launch__cloud {
  position: absolute;
  translate: calc(var(--px, 0) * var(--d) * 14px) calc(var(--py, 0) * var(--d) * 8px);
  transition: translate 900ms var(--ylf-ease-standard);
  filter: drop-shadow(0 6px 10px rgb(30 80 150 / 18%));
}

.launch__cloud--back {
  --d: 0.4;

  bottom: 6cqh;
  left: -6cqw;
  width: 46cqw;
  opacity: 0.9;
}

.launch__cloud--far {
  --d: 0.2;

  top: 10cqh;
  left: 10cqw;
  width: 14cqw;
  opacity: 0.75;
  animation: launch-drift 9s ease-in-out infinite alternate;
}

.launch__cloud--front {
  --d: 1.2;

  right: 4cqw;
  bottom: -4cqh;
  z-index: 3;
  width: 24cqw;
  animation: ylf-bob 5s ease-in-out infinite;
}

.launch__float {
  /* 窗口按画框较紧的一边取宽；内部尺寸都以 --u（窗口宽 / 62）为单位，任何比例都不溢出 */
  --w: min(58cqw, 122cqh);
  --u: calc(var(--w) / 62);

  position: relative;
  z-index: 2;
  width: var(--w);
  animation: ylf-bob 6s ease-in-out infinite;
}

/* 窗口跟着鼠标倾斜，像被风托着 */
.launch__window {
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 70%);
  border-radius: calc(3.2 * var(--u));
  background: var(--ylf-surface);
  box-shadow:
    0 calc(2.5 * var(--u)) calc(6 * var(--u)) calc(-2 * var(--u)) rgb(15 55 114 / 35%),
    inset 0 1px 0 rgb(255 255 255 / 60%);
  cursor: pointer;
  transform: perspective(900px) rotateX(calc(var(--py, 0) * -7deg)) rotateY(calc(var(--px, 0) * 9deg));
  transition:
    transform 700ms var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.launch__window:active {
  scale: 0.97;
  transition-duration: 700ms, 100ms;
}

.launch__bar {
  display: flex;
  align-items: center;
  gap: calc(1 * var(--u));
  padding: calc(1.6 * var(--u)) calc(2 * var(--u));
  background: var(--ylf-surface-muted);
}

.launch__dot {
  width: calc(1.5 * var(--u));
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--c);
}

.launch__url {
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: calc(0.8 * var(--u));
  margin-inline-start: calc(1.5 * var(--u));
  border-radius: 99px;
  padding: calc(0.6 * var(--u)) calc(1.5 * var(--u));
  color: var(--ui-text-muted);
  background: var(--ylf-surface);
  font-size: max(9px, calc(2.1 * var(--u)));
  font-weight: 600;
  white-space: nowrap;
}

.launch__lock {
  width: calc(1.2 * var(--u));
  height: calc(1.2 * var(--u));
  border-radius: calc(0.3 * var(--u));
  background: var(--ylf-palette-green);
}

.launch__page {
  display: grid;
  gap: calc(2 * var(--u));
  padding: calc(2.4 * var(--u));
}

.launch__hero {
  position: relative;
  display: grid;
  overflow: hidden;
  gap: calc(1.2 * var(--u));
  border-radius: calc(2 * var(--u));
  padding: calc(3 * var(--u));
  background: linear-gradient(150deg, var(--ylf-palette-blue), #7cc4f2);
}

.launch__hero-cloud {
  position: absolute;
  top: calc(0.5 * var(--u));
  right: calc(2 * var(--u));
  width: calc(13 * var(--u));
  animation: ylf-bob 4s ease-in-out infinite;
}

.launch__line {
  display: block;
  height: calc(1.6 * var(--u));
  border-radius: 99px;
  background: rgb(255 255 255 / 90%);
}

.launch__line--title {
  width: 46%;
  height: calc(2.2 * var(--u));
}

.launch__line--sub {
  width: 32%;
  opacity: 0.7;
}

.launch__cta {
  width: calc(14 * var(--u));
  height: calc(3.2 * var(--u));
  margin-top: calc(0.6 * var(--u));
  border-radius: 99px;
  background: #fff;
  animation: launch-pulse 2.4s var(--ylf-ease-standard) infinite;
}

.launch__tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: calc(1.6 * var(--u));
}

/* 三块内容依次加载、亮起，循环往复 */
.launch__tile {
  height: calc(7 * var(--u));
  border-radius: calc(1.6 * var(--u));
  background: var(--ylf-surface-muted);
  animation: launch-load 3.6s var(--ylf-ease-standard) calc(var(--n) * 0.25s) infinite;
}

.launch__tile:nth-child(1) {
  --tile: var(--ylf-palette-cyan);
}

.launch__tile:nth-child(2) {
  --tile: var(--ylf-palette-sun);
}

.launch__tile:nth-child(3) {
  --tile: var(--ylf-palette-pink);
}

.launch__sticker {
  position: absolute;
  top: calc(-2.4 * var(--u));
  right: calc(-3 * var(--u));
  z-index: 2;
  border-radius: calc(1.4 * var(--u));
  padding: calc(0.8 * var(--u)) calc(1.8 * var(--u));
  color: #fff;
  background: var(--ylf-gradient-member);
  box-shadow: 0 calc(1.5 * var(--u)) calc(3 * var(--u)) calc(-1 * var(--u)) rgb(244 81 106 / 55%);
  font-size: max(10px, calc(2.4 * var(--u)));
  font-weight: 700;
  rotate: 8deg;
  transition: rotate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.launch__float:hover .launch__sticker {
  rotate: -6deg;
}

.launch__confetti {
  position: absolute;
  z-index: 5;
  width: 7px;
  height: 11px;
  margin: -5px 0 0 -3px;
  border-radius: 2px;
  pointer-events: none;
  animation: launch-confetti 1.2s cubic-bezier(0.2, 0.7, 0.4, 1) forwards;
}

.launch__confetti--round {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

@keyframes launch-drift {
  to {
    transform: translateX(8cqw);
  }
}

@keyframes launch-pulse {
  50% {
    box-shadow: 0 0 0 calc(1.2 * var(--u)) rgb(255 255 255 / 25%);
  }
}

@keyframes launch-load {
  0%,
  12% {
    background: var(--ylf-surface-muted);
  }
  30%,
  80% {
    background: color-mix(in srgb, var(--tile) 70%, var(--ylf-surface));
  }
  100% {
    background: var(--ylf-surface-muted);
  }
}

@keyframes launch-confetti {
  0% {
    opacity: 1;
    transform: translate(0, 0) rotate(0);
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), calc(var(--dy) + 80px)) rotate(var(--rot));
  }
}
</style>
