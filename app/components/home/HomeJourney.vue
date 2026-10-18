<script setup lang="ts">
import { vReveal } from '~/composables/useReveal'
import HomeJourneyArt from './HomeJourneyArt.vue'

interface JourneyItem {
  title: string
  description: string
  icon: string
  to?: string
  linkLabel?: string
}

defineProps<{
  journey: {
    headline: string
    title: string
    description: string
    items: JourneyItem[]
  }
}>()

const accents = ['var(--ylf-dopa-blue)', 'var(--ylf-dopa-orange)', 'var(--ylf-dopa-green)']
const artwork = ['browse', 'launch', 'account'] as const
</script>

<template>
  <section class="home-journey" aria-labelledby="home-journey-title">
    <AppContainer>
      <header v-reveal class="home-journey__header">
        <p>{{ journey.headline }}</p>
        <h2 id="home-journey-title">
          {{ journey.title }}
        </h2>
        <span>{{ journey.description }}</span>
      </header>

      <!-- 纸飞机沿着三站航线飞过一次，飞到哪站，哪站亮起。 -->
      <div v-reveal="100" class="home-journey__flight" aria-hidden="true">
        <span class="home-journey__trail" />
        <span
          v-for="(accent, index) in accents"
          :key="accent"
          class="home-journey__stop"
          :style="{ '--stop': index, '--step-accent': accent }"
        />
        <span class="home-journey__plane"><Icon name="i-lucide-send" /></span>
      </div>

      <ol class="home-journey__steps">
        <li
          v-for="(item, index) in journey.items"
          :key="item.title"
          v-reveal="index * 120"
          :style="{ '--step-accent': accents[index % accents.length] }"
        >
          <div class="home-journey__visual" aria-hidden="true">
            <span class="home-journey__index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="home-journey__route" />
            <span class="home-journey__icon"><Icon :name="item.icon" /></span>
            <HomeJourneyArt :kind="artwork[index % artwork.length]!" />
          </div>
          <div class="home-journey__copy">
            <h3>{{ item.title }}</h3>
            <p>{{ item.description }}</p>
            <NuxtLink v-if="item.to" :to="item.to">
              {{ item.linkLabel }}
              <Icon name="i-lucide-arrow-up-right" aria-hidden="true" />
            </NuxtLink>
          </div>
        </li>
      </ol>
    </AppContainer>
  </section>
</template>

<style scoped>
.home-journey {
  padding-block: clamp(1rem, 4vw, 3rem) clamp(3rem, 7vw, 5rem);
}

.home-journey__header {
  max-width: 40rem;
}

.home-journey__header > p {
  color: var(--ui-primary);
  font-size: 0.75rem;
  font-weight: 650;
}

.home-journey__header h2 {
  margin-top: 0.55rem;
  color: var(--ui-text-highlighted);
  font-size: var(--ylf-type-headline);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.3;
  text-wrap: balance;
}

.home-journey__header > span {
  display: block;
  margin-top: 0.85rem;
  color: var(--ui-text-muted);
  font-size: 0.9rem;
  line-height: 1.75;
}

.home-journey__flight {
  position: relative;
  display: none;
  height: 2.5rem;
  margin-top: 2rem;
  container-type: inline-size;
}

.home-journey__trail {
  position: absolute;
  top: 50%;
  right: 1rem;
  left: 0;
  border-top: 2px dashed color-mix(in srgb, var(--ui-primary) 35%, transparent);
}

.home-journey__stop {
  position: absolute;
  top: 50%;
  left: calc(100% * (1 + 2 * var(--stop)) / 6);
  width: 0.75rem;
  height: 0.75rem;
  margin: -0.375rem 0 0 -0.375rem;
  border: 2px solid var(--ui-bg);
  border-radius: 50%;
  background: var(--step-accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--step-accent) 18%, transparent);
}

.home-journey__plane {
  position: absolute;
  top: 50%;
  left: 0;
  display: grid;
  width: 2rem;
  height: 2rem;
  margin-top: -1rem;
  place-items: center;
  border-radius: 50%;
  background: var(--ui-primary);
  box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--ui-primary) 70%, transparent);
  color: var(--ylf-c-text-on-accent);
  translate: calc(100cqw - 2rem) 0;
  animation: home-plane-bob 3.2s ease-in-out infinite;
}

.home-journey__plane > :deep(*) {
  width: 0.95rem;
  height: 0.95rem;
  rotate: 45deg;
  translate: -1px 1px;
}

/* 只有被滚动揭示时才起飞；首屏可见或无脚本时直接停在终点。 */
.home-journey__flight.ylf-reveal--in .home-journey__plane {
  animation:
    home-plane-fly 2400ms cubic-bezier(0.45, 0, 0.2, 1) 350ms backwards,
    home-plane-bob 3.2s ease-in-out infinite;
}

.home-journey__flight.ylf-reveal--in .home-journey__trail {
  animation: home-trail-draw 2400ms cubic-bezier(0.45, 0, 0.2, 1) 350ms backwards;
}

.home-journey__flight.ylf-reveal--in .home-journey__stop {
  animation: home-stop-pop 700ms var(--ylf-ease-spring) calc(350ms + 2400ms * (1 + 2 * var(--stop)) / 6 - 200ms)
    backwards;
}

.home-journey__steps {
  display: grid;
  gap: 1.15rem;
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
}

.home-journey__steps li {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-muted);
  border-radius: var(--ylf-radius-lg);
  background: var(--ui-bg-elevated);
  transition:
    border-color var(--ylf-duration-fast) var(--ylf-ease-standard),
    box-shadow var(--ylf-duration-fast) var(--ylf-ease-standard),
    scale var(--ylf-duration-slow) var(--ylf-ease-spring);
}

/* 与戳云一致的按压回弹。 */
.home-journey__steps li:active {
  scale: 0.98;
}

.home-journey__visual :deep(.journey-art) {
  transition:
    translate var(--ylf-duration-slow) var(--ylf-ease-spring),
    rotate var(--ylf-duration-slow) var(--ylf-ease-spring);
}

@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .home-journey__steps li:hover {
    border-color: color-mix(in srgb, var(--step-accent) 35%, var(--ui-border));
    box-shadow: 0 18px 36px -24px color-mix(in srgb, var(--step-accent) 55%, transparent);
  }

  .home-journey__steps li:hover .home-journey__visual :deep(.journey-art) {
    translate: 0 -6px;
    rotate: -2deg;
  }

  .home-journey__steps li:hover :deep(.journey-art__app) {
    animation: home-tile-hop 620ms var(--ylf-ease-spring);
  }

  .home-journey__steps li:hover :deep(.journey-art__app:nth-child(2)) {
    animation-delay: 70ms;
  }

  .home-journey__steps li:hover :deep(.journey-art__app:nth-child(3)) {
    animation-delay: 140ms;
  }

  .home-journey__steps li:hover :deep(.journey-art__app:nth-child(4)) {
    animation-delay: 210ms;
  }

  .home-journey__steps li:hover :deep(.journey-art__pass-check) {
    animation: home-tile-hop 620ms var(--ylf-ease-spring);
  }

  .home-journey__steps li:hover .home-journey__icon {
    animation: home-icon-wiggle 600ms var(--ylf-ease-standard);
  }
}

@keyframes home-plane-fly {
  from {
    translate: 0 0;
  }
}

@keyframes home-plane-bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

@keyframes home-trail-draw {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

@keyframes home-stop-pop {
  from {
    opacity: 0;
    scale: 0.2;
  }
}

@keyframes home-tile-hop {
  40% {
    translate: 0 -8px;
    scale: 1.08;
  }
}

@keyframes home-icon-wiggle {
  25% {
    rotate: -14deg;
  }
  60% {
    rotate: 10deg;
  }
}

.home-journey__visual {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  height: 13.5rem;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-bottom: 1px solid color-mix(in srgb, var(--step-accent) 12%, var(--ui-border-muted));
  padding-top: 3rem;
  background: color-mix(in srgb, var(--step-accent) 7%, var(--ui-bg-muted));
}

.home-journey__index {
  position: absolute;
  top: 1.1rem;
  left: 1.4rem;
  display: inline-block;
  width: 2ch;
  color: var(--step-accent);
  font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 1.5rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings:
    'tnum' 1,
    'lnum' 1;
  letter-spacing: 0;
  line-height: 2rem;
}

.home-journey__route {
  position: absolute;
  top: 2.1rem;
  right: 3.6rem;
  left: 4.25rem;
  border-top: 1px solid color-mix(in srgb, var(--step-accent) 18%, transparent);
}

.home-journey__icon {
  position: absolute;
  top: 1.1rem;
  right: 1.4rem;
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--step-accent) 18%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-bg-elevated) 70%, transparent);
  color: var(--step-accent);
}

.home-journey__icon :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.home-journey__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 1.5rem;
}

.home-journey__copy h3 {
  color: var(--ui-text-highlighted);
  font-size: 1.05rem;
  font-weight: 650;
  line-height: 1.5;
}

.home-journey__copy p {
  max-width: 22rem;
  margin-top: 0.65rem;
  color: var(--ui-text-muted);
  font-size: 0.85rem;
  line-height: 1.8;
}

.home-journey__copy a {
  display: inline-flex;
  width: fit-content;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.5rem;
  margin-top: auto;
  padding-top: 0.75rem;
  border-radius: 0.35rem;
  color: var(--ui-primary);
  font-size: 0.8rem;
  font-weight: 600;
}

.home-journey__copy a :deep(svg) {
  width: 0.95rem;
  height: 0.95rem;
}

@media (min-width: 768px) {
  .home-journey__flight {
    display: block;
  }

  .home-journey__steps {
    margin-top: 1rem;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .home-journey__copy {
    min-height: 12rem;
  }
}

@media (max-width: 1023px) and (min-width: 768px) {
  .home-journey__visual {
    --journey-art-scale: 0.9;
  }
}

@media (max-width: 767px) {
  .home-journey__steps li {
    display: grid;
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.45fr);
    min-height: 12.5rem;
  }

  .home-journey__visual {
    --journey-art-scale: 0.85;
    height: 100%;
    border-right: 1px solid color-mix(in srgb, var(--step-accent) 12%, var(--ui-border-muted));
    border-bottom: none;
    padding-top: 2.5rem;
  }

  .home-journey__index {
    top: 1rem;
    left: 1rem;
    font-size: 1.35rem;
  }

  .home-journey__route {
    top: 2rem;
    right: 1.25rem;
    left: 3.5rem;
  }

  .home-journey__icon {
    display: none;
  }

  .home-journey__copy {
    padding: 1.5rem 1.25rem;
  }
}

@media (max-width: 479px) {
  .home-journey__visual {
    --journey-art-scale: 0.62;
  }

  .home-journey__copy {
    padding: 1.35rem 1rem;
  }

  .home-journey__copy h3 {
    font-size: 1rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-journey__plane,
  .home-journey__flight.ylf-reveal--in .home-journey__plane,
  .home-journey__flight.ylf-reveal--in .home-journey__trail,
  .home-journey__flight.ylf-reveal--in .home-journey__stop {
    animation: none;
  }

  .home-journey__visual :deep(.journey-art) {
    transition: none;
  }

  .home-journey__steps li:active {
    scale: none;
  }
}

@media (max-width: 359px) {
  .home-journey__steps li {
    min-height: 14.5rem;
  }

  .home-journey__visual {
    --journey-art-scale: 0.5;
  }
}
</style>
