<script setup lang="ts">
/**
 * 云端航线：两个端点（云乐坊 / 账号 → 目标应用）之间一道虚线弧，一朵小云沿弧飞行。
 *
 * 登录页用它说明「登录后回到哪个应用」，SSO 确认页用它说明「哪个账号要登录哪个应用」。
 * 小云的动作跟随真实进度：
 * - idle：停在弧顶轻轻浮动，等待用户操作；
 * - flying：登录 / 签发授权进行中，沿弧往返飞行；
 * - arrived：成功后飞向目标应用并「降落」，目标光环亮起一圈。
 * 减少动态效果时一律静止。端点内容由插槽提供。
 */
export type AuthRouteState = 'idle' | 'flying' | 'arrived'

withDefaults(defineProps<{
  fromLabel: string
  toLabel: string
  /** 目标端点下方的次要说明，通常是应用域名 */
  toHint?: string
  /** 目标来源无法核验时，用警示色描出次要说明 */
  toHintTone?: 'safe' | 'warning'
  accent?: string
  state?: AuthRouteState
}>(), {
  toHint: '',
  toHintTone: 'safe',
  accent: 'var(--ylf-sso-accent)',
  state: 'idle',
})
</script>

<template>
  <div class="auth-route" :class="`auth-route--${state}`" :style="{ '--auth-route-accent': accent }">
    <div class="auth-route__end">
      <div class="auth-route__node">
        <slot name="from" />
      </div>
      <span class="auth-route__label">{{ fromLabel }}</span>
    </div>

    <div class="auth-route__track" aria-hidden="true">
      <svg class="auth-route__arc" viewBox="0 0 120 36" preserveAspectRatio="none">
        <path d="M2 30 Q60 -8 118 30" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="auth-route__traveler-x">
        <span class="auth-route__traveler-y">
          <svg class="auth-route__cloud" viewBox="0 0 28 16">
            <path d="M7 15h15a5 5 0 0 0 .6-9.96A7 7 0 0 0 9.4 4.2 5.4 5.4 0 0 0 7 15Z" />
          </svg>
        </span>
      </span>
    </div>

    <div class="auth-route__end">
      <div class="auth-route__node auth-route__node--to">
        <slot name="to" />
      </div>
      <span class="auth-route__label auth-route__label--strong">{{ toLabel }}</span>
      <span v-if="toHint" class="auth-route__hint" :class="`auth-route__hint--${toHintTone}`">
        <Icon :name="toHintTone === 'safe' ? 'i-lucide-lock-keyhole' : 'i-lucide-triangle-alert'" class="mt-px size-3 shrink-0" />
        <!-- 域名是核对来源的依据，窄屏按点号折行，绝不截断 -->
        <span class="auth-route__host"><template v-for="(part, index) in toHint.split('.')" :key="index"><template v-if="index">.<wbr></template>{{ part }}</template></span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.auth-route {
  --_accent: var(--auth-route-accent);

  display: grid;
  /* 航线随宽度收缩，把空间优先留给两端的名称与域名 */
  grid-template-columns: minmax(0, 1fr) minmax(2.75rem, 0.8fr) minmax(0, 1fr);
  align-items: start;
  gap: 0.25rem;
}

.auth-route__end {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  text-align: center;
}

.auth-route__node {
  --app-icon-size: 3rem;

  position: relative;
  display: grid;
  width: 3.25rem;
  height: 3.25rem;
  place-items: center;
}

/* 目标应用外圈一道随强调色的光环，暗示「目的地」 */
.auth-route__node--to::before {
  position: absolute;
  inset: -0.25rem;
  border: 1.5px dashed color-mix(in srgb, var(--_accent) 46%, transparent);
  border-radius: 30%;
  content: '';
}

.auth-route__label {
  display: -webkit-box;
  max-width: 100%;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  color: var(--ui-text-muted);
  font-size: var(--ylf-type-caption);
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.auth-route__label--strong {
  color: var(--ui-text-highlighted);
  font-weight: 600;
}

.auth-route__hint {
  display: inline-flex;
  max-width: 100%;
  align-items: flex-start;
  gap: 0.25rem;
  margin-top: -0.125rem;
  font-size: 0.6875rem;
  line-height: 1.2;
}

.auth-route__host {
  min-width: 0;
  overflow-wrap: break-word;
  text-align: left;
}

.auth-route__hint--safe {
  color: var(--ui-text-muted);
}

.auth-route__hint--warning {
  color: var(--ylf-status-warning-text, #b45309);
}

.auth-route__track {
  position: relative;
  height: 2.25rem;
  margin-top: 0.5rem;
}

.auth-route__arc {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.auth-route__arc path {
  fill: none;
  stroke: color-mix(in srgb, var(--_accent) 52%, var(--ui-border));
  stroke-dasharray: 2 5;
  stroke-linecap: round;
  stroke-width: 2;
}

.auth-route--flying .auth-route__arc path {
  animation: auth-route-dash 1.6s linear infinite;
}

/* 水平匀速 + 垂直先升后降，两层位移叠出沿弧飞行的轨迹 */
.auth-route__traveler-x {
  position: absolute;
  top: 0;
  left: 50%;
  translate: -50% 0;
}

/* 静止时停在弧顶；位移值按 120×36 的弧线与云朵高度换算，云心贴着弧线走 */
.auth-route__traveler-y {
  display: block;
  translate: 0 0.25rem;
}

.auth-route--idle .auth-route__traveler-y {
  animation: auth-route-bob 3.2s ease-in-out infinite;
}

.auth-route--flying .auth-route__traveler-x {
  animation: auth-route-x 2.8s linear infinite;
}

.auth-route--flying .auth-route__traveler-y {
  animation: auth-route-y 1.4s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite alternate;
}

/* 降落：从弧顶加速滑向目标，越近越小、最后隐入应用图标 */
.auth-route--arrived .auth-route__traveler-x {
  animation: auth-route-arrive-x 720ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.auth-route--arrived .auth-route__traveler-y {
  animation: auth-route-arrive-y 720ms cubic-bezier(0.55, 0, 1, 0.45) forwards;
}

.auth-route--arrived .auth-route__node--to::before {
  border-style: solid;
  border-color: color-mix(in srgb, var(--_accent) 70%, transparent);
  animation: auth-route-ring 900ms 560ms ease-out both;
}

.auth-route__cloud {
  display: block;
  width: 1.5rem;
  height: auto;
  overflow: visible;
  filter: drop-shadow(0 3px 6px color-mix(in srgb, var(--_accent) 40%, transparent));
}

.auth-route__cloud path {
  fill: var(--ylf-cloud-highlight, #fff);
  stroke: color-mix(in srgb, var(--_accent) 70%, transparent);
  stroke-width: 1.2;
}

@keyframes auth-route-dash {
  to {
    stroke-dashoffset: -14;
  }
}

@keyframes auth-route-x {
  0% {
    left: 6%;
    opacity: 0;
  }
  12%,
  88% {
    opacity: 1;
  }
  100% {
    left: 94%;
    opacity: 0;
  }
}

@keyframes auth-route-bob {
  0%,
  100% {
    translate: 0 0.25rem;
  }
  50% {
    translate: 0 0;
  }
}

@keyframes auth-route-arrive-x {
  from {
    left: 50%;
  }
  80% {
    opacity: 1;
    scale: 0.85;
  }
  to {
    left: 94%;
    opacity: 0;
    scale: 0.5;
  }
}

@keyframes auth-route-arrive-y {
  from {
    translate: 0 0.25rem;
  }
  to {
    translate: 0 1.25rem;
  }
}

@keyframes auth-route-ring {
  from {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--_accent) 45%, transparent);
  }
  to {
    box-shadow: 0 0 0 0.625rem transparent;
  }
}

@keyframes auth-route-y {
  from {
    translate: 0 1.25rem;
  }
  to {
    translate: 0 0.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-route .auth-route__arc path,
  .auth-route .auth-route__traveler-x,
  .auth-route .auth-route__traveler-y,
  .auth-route .auth-route__node--to::before {
    animation: none;
  }
}
</style>
