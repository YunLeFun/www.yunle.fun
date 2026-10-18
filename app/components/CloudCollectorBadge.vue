<script setup lang="ts">
/**
 * 云朵收藏里程碑：戳云满 10 / 50 / 100 下时，顶部飘出一枚「云朵收藏家」小徽章，
 * 撒一把六色彩纸后自己收起。由 app.vue 懒加载，真正到达里程碑时才下载这段代码。
 * 减少动态效果时不撒彩纸，徽章直接出现、消失。
 */
const props = defineProps<{ count: number }>()
const emit = defineEmits<{ done: [] }>()

const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const COLORS = ['blue', 'cyan', 'green', 'sun', 'coral', 'pink']
// 彩纸方向均匀铺开、不取随机数，每次都是同一朵漂亮的花
const pieces = Array.from({ length: 14 }, (_, index) => {
  const angle = (index / 14) * Math.PI * 2
  const distance = 40 + (index % 3) * 14
  return {
    '--dx': `${Math.round(Math.cos(angle) * distance * 1.5)}px`,
    '--dy': `${Math.round(Math.sin(angle) * distance - 12)}px`,
    '--rot': `${(index % 2 ? 1 : -1) * (200 + index * 24)}deg`,
    'background': `var(--ylf-palette-${COLORS[index % COLORS.length]})`,
  }
})

const open = shallowRef(true)
const timer = setTimeout(() => {
  open.value = false
}, 3600)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Transition name="cloud-badge" appear @after-leave="emit('done')">
    <div v-if="open" class="cloud-badge" role="status">
      <span class="cloud-badge__art">
        <CuteCloud shape="round" face mood="happy" />
        <span v-if="!reducedMotion" class="cloud-badge__confetti" aria-hidden="true">
          <i v-for="(style, index) in pieces" :key="index" :style="style" />
        </span>
      </span>
      <span class="cloud-badge__text">
        <strong>云朵收藏家</strong>
        <span>已经戳过 {{ props.count }} 下云朵</span>
      </span>
    </div>
  </Transition>
</template>

<style scoped>
.cloud-badge {
  position: fixed;
  z-index: 90;
  top: 4.75rem;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  max-width: calc(100vw - 2rem);
  border-radius: var(--ylf-radius-pill);
  padding: 0.4rem 1.1rem 0.4rem 0.5rem;
  color: var(--ylf-c-text);
  background: var(--ylf-c-panel);
  box-shadow: var(--ylf-shadow-panel);
  translate: -50% 0;
  pointer-events: none;
}

/* 白云放在一小块晴空圆底上，浅色面板里也看得清 */
.cloud-badge__art {
  position: relative;
  display: grid;
  width: 2.5rem;
  flex-shrink: 0;
  aspect-ratio: 1;
  border-radius: 50%;
  padding: 0.3rem;
  background: linear-gradient(170deg, #2f82e0, #9fd2f5);
  place-items: center;
}

.dark .cloud-badge__art {
  background: linear-gradient(170deg, #33386f, #c77fa6);
}

.cloud-badge__text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  white-space: nowrap;
}

.cloud-badge__text strong {
  font-size: var(--ylf-text-sm);
  font-weight: 700;
}

.cloud-badge__text span {
  color: var(--ylf-c-text-2);
  font-size: var(--ylf-text-xs);
}

.cloud-badge__confetti i {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 7px;
  height: 9px;
  border-radius: 2px;
  opacity: 0;
  animation: cloud-badge-confetti 1100ms cubic-bezier(0.2, 0.6, 0.3, 1) 160ms;
}

.cloud-badge__confetti i:nth-child(3n) {
  border-radius: 50%;
}

.cloud-badge-enter-active {
  transition:
    opacity var(--ylf-duration-normal) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring),
    translate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

.cloud-badge-leave-active {
  transition:
    opacity var(--ylf-duration-exit) var(--ylf-ease-standard),
    translate var(--ylf-duration-exit) var(--ylf-ease-standard);
}

.cloud-badge-enter-from {
  opacity: 0;
  scale: 0.7;
  translate: -50% -0.75rem;
}

.cloud-badge-leave-to {
  opacity: 0;
  translate: -50% -0.5rem;
}

@keyframes cloud-badge-confetti {
  0% {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(0) scale(0.5);
  }
  60% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) rotate(var(--rot)) scale(1);
  }
}
</style>
