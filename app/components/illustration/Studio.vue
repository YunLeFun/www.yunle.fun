<script setup lang="ts">
/**
 * 「工作室成立」插画：小山坡上的一间工坊，烟囱里冒出一朵朵小云。
 *
 * 悬停时门会推开一条缝；点一下工坊，窗户亮灯、烟囱多冒几朵云，再点一下关灯。
 */
const lit = shallowRef(false)
const puffs = shallowRef<number[]>([])
let seed = 0

function toggle() {
  lit.value = !lit.value
  const batch = [++seed, ++seed, ++seed]
  puffs.value = [...puffs.value, ...batch]
  setTimeout(() => {
    puffs.value = puffs.value.filter(id => !batch.includes(id))
  }, 2600)
}
</script>

<template>
  <IllustrationFrame tone="dawn">
    <div class="studio" :class="{ 'is-lit': lit }">
      <CuteCloud shape="long" class="studio__cloud studio__cloud--back" />
      <CuteCloud shape="small" class="studio__cloud studio__cloud--far" />

      <span class="studio__hill studio__hill--back" />
      <span class="studio__hill" />

      <div class="studio__house" @click="toggle">
        <!-- 烟囱里常驻冒出的三朵小云，点击时再加一串 -->
        <span class="studio__chimney">
          <CuteCloud v-for="n in 3" :key="`loop-${n}`" shape="small" class="studio__puff" :style="{ '--n': n }" />
          <CuteCloud v-for="id in puffs" :key="id" shape="small" class="studio__puff studio__puff--burst" :style="{ '--n': id % 3 }" />
        </span>
        <span class="studio__roof" />
        <span class="studio__body">
          <span class="studio__sign">云乐坊工作室</span>
          <span class="studio__window" />
          <span class="studio__window studio__window--right" />
          <span class="studio__door" />
        </span>
      </div>

      <CuteCloud shape="round" face :mood="lit ? 'happy' : 'calm'" class="studio__cloud studio__cloud--front" />
      <span class="studio__sparkle" />
    </div>
  </IllustrationFrame>
</template>

<style scoped>
.studio {
  position: absolute;
  inset: 0;
}

.studio__cloud {
  position: absolute;
  translate: calc(var(--px, 0) * var(--d) * 14px) calc(var(--py, 0) * var(--d) * 8px);
  transition: translate 900ms var(--ylf-ease-standard);
  filter: drop-shadow(0 6px 10px rgb(30 80 150 / 18%));
}

.studio__cloud--back {
  --d: 0.3;

  top: 16cqh;
  left: -6cqw;
  width: 34cqw;
  opacity: 0.9;
}

.studio__cloud--far {
  --d: 0.15;

  top: 10cqh;
  right: 16cqw;
  width: 12cqw;
  opacity: 0.75;
}

.studio__cloud--front {
  --d: 1.1;

  right: 4cqw;
  bottom: 6cqh;
  z-index: 4;
  width: 20cqw;
  animation: ylf-bob 5s ease-in-out infinite;
}

.studio__hill {
  position: absolute;
  z-index: 1;
  left: -10cqw;
  right: -10cqw;
  bottom: -46cqh;
  height: 70cqh;
  border-radius: 50%;
  background: linear-gradient(#9fdcb4, #6fc194);
}

.studio__hill--back {
  z-index: 0;
  left: 30cqw;
  right: -30cqw;
  bottom: -38cqh;
  background: linear-gradient(#c3ead0, #9fdcb4);
}

.dark .studio__hill {
  background: linear-gradient(#5c7d82, #3d5a66);
}

.dark .studio__hill--back {
  background: linear-gradient(#7a8fa0, #5c7d82);
}

/* 工坊：随鼠标轻轻侧身 */
.studio__house {
  position: absolute;
  z-index: 2;
  bottom: 18cqh;
  left: 50%;
  width: min(34cqw, 60cqh);
  aspect-ratio: 1 / 0.92;
  cursor: pointer;
  translate: -50% 0;
  transform: perspective(900px) rotateY(calc(var(--px, 0) * 10deg));
  transition: transform 700ms var(--ylf-ease-standard);
}

.studio__roof {
  position: absolute;
  z-index: 1;
  top: 0;
  left: -8%;
  width: 116%;
  height: 46%;
  background: linear-gradient(160deg, var(--ylf-palette-coral), #e8553a);
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  filter: drop-shadow(0 4px 0 rgb(0 0 0 / 10%));
}

.studio__body {
  position: absolute;
  z-index: 2;
  inset: 44% 4% 0;
  border-radius: 0 0 6% 6%;
  background: #fffaf2;
  box-shadow: inset 0 -1.2cqh 0 rgb(0 0 0 / 6%);
}

.dark .studio__body {
  background: #f1e3d6;
}

.studio__sign {
  position: absolute;
  top: -6%;
  left: 50%;
  border-radius: 1cqw;
  padding: 0.6cqh 1.4cqw;
  color: #fff;
  background: var(--ylf-palette-blue);
  font-size: max(9px, 3.4cqh);
  font-weight: 700;
  white-space: nowrap;
  translate: -50% -50%;
  box-shadow: 0 0.8cqh 1.6cqh -0.6cqh rgb(15 55 114 / 45%);
}

.studio__window {
  position: absolute;
  top: 26%;
  left: 12%;
  width: 22%;
  aspect-ratio: 1;
  border: 0.6cqh solid #8a6a4a;
  border-radius: 18%;
  background: #cfe6f7;
  transition:
    background-color var(--ylf-duration-normal) var(--ylf-ease-standard),
    box-shadow var(--ylf-duration-normal) var(--ylf-ease-standard);
}

.studio__window--right {
  left: auto;
  right: 12%;
}

.is-lit .studio__window {
  background: #ffe48a;
  box-shadow: 0 0 3cqh 1cqh rgb(255 214 90 / 65%);
}

.studio__door {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 22%;
  height: 46%;
  margin-left: -11%;
  border-radius: 40% 40% 0 0;
  background: #8a6a4a;
  transform-origin: 0 50%;
  transition: transform var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.studio__house:hover .studio__door {
  transform: perspective(300px) rotateY(-35deg);
}

.studio__chimney {
  position: absolute;
  z-index: 0;
  top: 8%;
  right: 16%;
  width: 11%;
  height: 26%;
  background: #8a6a4a;
}

.studio__puff {
  position: absolute;
  bottom: 90%;
  left: 50%;
  width: 7cqw;
  margin-left: -3.5cqw;
  opacity: 0;
  pointer-events: none;
  animation: studio-puff 4.2s ease-out calc(var(--n) * 1.4s) infinite;
}

.studio__puff--burst {
  animation: studio-puff 2.4s ease-out calc(var(--n) * 0.18s) forwards;
}

.studio__sparkle {
  position: absolute;
  z-index: 3;
  top: 20cqh;
  left: 56cqw;
  width: 3cqh;
  aspect-ratio: 1;
  background: #fff7c2;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  opacity: 0;
  scale: 0.4;
  transition:
    opacity var(--ylf-duration-normal) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.is-lit .studio__sparkle {
  opacity: 1;
  scale: 1;
  animation: studio-twinkle 1.6s ease-in-out infinite;
}

@keyframes studio-puff {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.4);
  }
  15% {
    opacity: 0.95;
  }
  100% {
    opacity: 0;
    transform: translate(6cqw, -36cqh) scale(1.6);
  }
}

@keyframes studio-twinkle {
  50% {
    rotate: 45deg;
    scale: 0.7;
  }
}
</style>
