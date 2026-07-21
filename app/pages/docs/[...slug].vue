<script setup lang="ts">
const route = useRoute()

const { data: page } = await useAsyncData(route.path, () => getDocPage(route.path))
if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const title = page.value.seo?.title || page.value.title
const description = page.value.seo?.description || page.value.description

const pageAnchors = computed(() => {
  const links = page.value?.toc?.links as Array<{ id?: string, text?: string }> | undefined

  return (links || [])
    .filter(link => link.id && link.text)
    .map(link => ({
      label: link.text!,
      to: `#${link.id}`,
    }))
})

const resourceLinks = [
  {
    label: '使用指南',
    description: '了解账号、应用与会员',
    icon: 'i-lucide-compass',
    to: '/docs/getting-started/usage',
  },
  {
    label: '开发者文档',
    description: '应用接入与开放规范',
    icon: 'i-lucide-braces',
    to: 'https://docs.yunle.fun',
    target: '_blank',
  },
  {
    label: '联系支持',
    description: '问题反馈、退款与客诉',
    icon: 'i-lucide-life-buoy',
    to: '/docs/contact',
  },
]

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})
</script>

<template>
  <div
    v-if="page"
    class="docs-page"
    :class="{ 'docs-page--featured': page.hero }"
  >
    <section v-if="page.hero" class="docs-hero">
      <div class="docs-hero__glow docs-hero__glow--blue" aria-hidden="true" />
      <div class="docs-hero__glow docs-hero__glow--violet" aria-hidden="true" />
      <div class="docs-hero__grid" aria-hidden="true" />

      <UContainer class="docs-hero__container">
        <div class="docs-hero__copy">
          <YlfEyebrow
            v-if="page.hero.eyebrow"
            :label="page.hero.eyebrow"
          />

          <h1 class="docs-hero__title">
            <span>{{ page.hero.title }}</span>
            <span v-if="page.hero.titleAccent" class="docs-hero__title-accent">
              {{ page.hero.titleAccent }}
            </span>
          </h1>
          <p v-if="page.hero.description" class="docs-hero__description">
            {{ page.hero.description }}
          </p>

          <div v-if="page.hero.links?.length" class="docs-hero__actions">
            <UButton
              v-for="(link, index) in page.hero.links"
              :key="link.to"
              v-bind="link"
              size="xl"
              :class="index === 0 ? 'ylf-brand-btn docs-hero__action docs-hero__action--primary' : 'docs-hero__action docs-hero__action--secondary'"
            />
          </div>
        </div>

        <div v-if="page.hero.steps?.length" class="docs-route-panel">
          <div class="docs-route-panel__header">
            <span class="docs-route-panel__title">
              <UIcon name="i-lucide-route" aria-hidden="true" />
              推荐上手路径
            </span>
            <span class="docs-route-panel__meta">只需两步</span>
          </div>

          <ol class="docs-route" aria-label="推荐上手路径">
            <li v-for="(step, index) in page.hero.steps" :key="step.to">
              <NuxtLink :to="step.to" class="docs-route__link">
                <span class="docs-route__index">{{ String(index + 1).padStart(2, '0') }}</span>
                <span class="docs-route__copy">
                  <strong>{{ step.label }}</strong>
                  <small>{{ step.description }}</small>
                </span>
                <span class="docs-route__arrow" aria-hidden="true">
                  <UIcon name="i-lucide-arrow-up-right" class="docs-route__icon" />
                </span>
              </NuxtLink>
            </li>
          </ol>
        </div>
      </UContainer>
    </section>

    <UContainer class="docs-content">
      <nav v-if="pageAnchors.length" class="docs-mobile-nav" aria-label="本页章节">
        <span class="docs-mobile-nav__label">
          <UIcon name="i-lucide-list" aria-hidden="true" />
          本页内容
        </span>
        <div class="docs-mobile-nav__links">
          <NuxtLink
            v-for="link in pageAnchors"
            :key="link.to"
            :to="link.to"
            class="docs-mobile-nav__link"
          >
            {{ link.label }}
          </NuxtLink>
        </div>
      </nav>

      <div class="docs-layout">
        <article class="docs-article">
          <UPageHeader
            v-if="!page.hero"
            :title="page.title"
            :description="page.description"
          />

          <UPageBody :class="page.hero ? 'mt-0 pb-16' : 'pb-16'">
            <MDCRenderer
              v-if="page.body"
              :body="page.body"
              :data="page"
              class="docs-prose"
            />
          </UPageBody>
        </article>

        <aside class="docs-aside" aria-label="文档导航">
          <div class="docs-aside__panel">
            <div v-if="pageAnchors.length" class="docs-aside__section">
              <p class="docs-aside__label">
                本页内容
              </p>
              <UPageAnchors :links="pageAnchors" />
            </div>

            <div class="docs-aside__section">
              <p class="docs-aside__label">
                继续了解
              </p>
              <NuxtLink
                v-for="link in resourceLinks"
                :key="link.to"
                :to="link.to"
                :target="link.target"
                :rel="link.target === '_blank' ? 'noopener noreferrer' : undefined"
                :aria-label="link.target === '_blank' ? `${link.label}（在新窗口打开）` : link.label"
                class="docs-resource"
              >
                <span class="docs-resource__icon-wrap" aria-hidden="true">
                  <UIcon :name="link.icon" class="docs-resource__icon" />
                </span>
                <span>
                  <strong>
                    {{ link.label }}
                    <UIcon
                      v-if="link.target === '_blank'"
                      name="i-lucide-external-link"
                      class="docs-resource__external"
                      aria-hidden="true"
                    />
                  </strong>
                  <small>{{ link.description }}</small>
                </span>
              </NuxtLink>
            </div>
          </div>
        </aside>
      </div>
    </UContainer>
  </div>
</template>

<style scoped>
.docs-page {
  position: relative;
  overflow: clip;
  --docs-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --docs-shadow: 0 1.5rem 4.5rem -2.5rem color-mix(in srgb, var(--ui-text-highlighted) 22%, transparent);
  --docs-cta-start: #1d4ed8;
  --docs-cta-end: #0369a1;
}

:global(.dark) .docs-page {
  --docs-cta-start: #2563eb;
  --docs-cta-end: #0e7490;
}

.docs-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-bottom: 1px solid var(--ui-border-muted);
  background:
    radial-gradient(circle at 12% 4%, color-mix(in srgb, var(--ylf-dopa-cyan) 15%, transparent), transparent 34%),
    radial-gradient(circle at 88% 82%, color-mix(in srgb, var(--ylf-dopa-violet) 13%, transparent), transparent 38%),
    linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 7%, var(--ui-bg)), var(--ui-bg) 58%);
}

.docs-hero::after {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  z-index: 0;
  height: 38%;
  background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--ui-bg) 84%, transparent));
  content: '';
  pointer-events: none;
}

.docs-hero__container {
  position: relative;
  z-index: 2;
  display: grid;
  gap: clamp(2.5rem, 6vw, 4.5rem);
  align-items: center;
  padding-top: clamp(4rem, 9vw, 7rem);
  padding-bottom: clamp(4rem, 8vw, 6.5rem);
}

.docs-hero__copy {
  max-width: 48rem;
}

.docs-hero__title {
  max-width: 48rem;
  margin-top: 1.25rem;
  color: var(--ui-text-highlighted);
  font-family: var(--ylf-font-dreamy);
  font-size: clamp(2.65rem, 7vw, 4.9rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.08;
  text-wrap: balance;
}

.docs-hero__title > span {
  display: block;
}

.docs-hero__title-accent {
  width: fit-content;
  max-width: 100%;
  margin-top: 0.12em;
  background: var(--ylf-gradient-brand);
  background-clip: text;
  color: transparent;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.docs-hero__description {
  max-width: 40rem;
  margin-top: 1.5rem;
  color: var(--ui-text-muted);
  font-size: clamp(1rem, 2vw, 1.15rem);
  line-height: 1.8;
  text-wrap: pretty;
}

.docs-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 2rem;
}

.docs-hero__action {
  min-height: 3rem;
  touch-action: manipulation;
}

.docs-hero__action--primary[data-slot='base'] {
  background: linear-gradient(115deg, var(--docs-cta-start), var(--docs-cta-end));
  color: white;
}

.docs-hero__action--secondary[data-slot='base'] {
  border-color: color-mix(in srgb, var(--ui-border) 88%, transparent);
  background: color-mix(in srgb, var(--ylf-surface) 72%, transparent);
  box-shadow: 0 0.75rem 2rem -1.5rem color-mix(in srgb, var(--ui-text-highlighted) 28%, transparent);
  backdrop-filter: blur(12px);
}

.docs-hero__action--secondary[data-slot='base']:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 46%, var(--ui-border));
  background: color-mix(in srgb, var(--ylf-surface) 92%, transparent);
}

.docs-hero__grid {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.4;
  background-image: radial-gradient(color-mix(in srgb, var(--ui-text) 16%, transparent) 1px, transparent 1px);
  background-size: 30px 30px;
  mask-image: radial-gradient(ellipse 86% 80% at 50% 28%, black, transparent 78%);
}

.docs-hero__glow {
  position: absolute;
  z-index: 1;
  width: 28rem;
  height: 28rem;
  border-radius: 9999px;
  filter: blur(100px);
  opacity: 0.16;
  pointer-events: none;
}

.docs-hero__glow--blue {
  top: -15rem;
  left: -10rem;
  background: var(--ylf-dopa-cyan);
}

.docs-hero__glow--violet {
  right: -12rem;
  bottom: -16rem;
  background: var(--ylf-dopa-violet);
}

.docs-route-panel {
  position: relative;
  border: 1px solid color-mix(in srgb, var(--ui-border) 78%, transparent);
  border-radius: 1.5rem;
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ylf-surface) 82%, transparent);
  box-shadow: var(--docs-shadow);
  backdrop-filter: blur(20px) saturate(130%);
}

.docs-route-panel::before {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(135deg, color-mix(in srgb, white 32%, transparent), transparent 46%);
  content: '';
  pointer-events: none;
}

.docs-route-panel__header {
  position: relative;
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  min-height: 2.75rem;
  padding: 0.25rem 0.5rem 0.75rem;
}

.docs-route-panel__title {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--ui-text-highlighted);
  font-size: 0.78rem;
  font-weight: 750;
  letter-spacing: 0.05em;
}

.docs-route-panel__title svg {
  width: 1rem;
  height: 1rem;
  color: var(--ui-primary);
}

.docs-route-panel__meta {
  border: 1px solid color-mix(in srgb, var(--ui-primary) 20%, transparent);
  border-radius: 9999px;
  padding: 0.25rem 0.55rem;
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
  color: color-mix(in srgb, var(--ui-primary) 86%, var(--ui-text-highlighted));
  font-size: 0.7rem;
  font-weight: 700;
}

.docs-route {
  position: relative;
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.docs-route__link {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 1rem;
  align-items: center;
  min-height: 5.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 74%, transparent);
  border-radius: 1rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--ylf-surface) 94%, transparent);
  box-shadow: 0 0.75rem 2rem -1.5rem color-mix(in srgb, var(--ui-text-highlighted) 24%, transparent);
  touch-action: manipulation;
  transition:
    transform 200ms var(--docs-ease),
    border-color 200ms ease,
    background-color 200ms ease,
    box-shadow 200ms ease;
}

.docs-route__link:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--ui-primary) 44%, var(--ui-border));
  background: var(--ylf-surface);
  box-shadow: 0 1.25rem 2.75rem -1.75rem color-mix(in srgb, var(--ui-primary) 42%, transparent);
}

.docs-route__link:active {
  transform: scale(0.985);
}

.docs-route__link:focus-visible {
  outline: 3px solid var(--ylf-ring);
  outline-offset: 3px;
}

.docs-route__index {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 22%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
  color: var(--ui-primary);
  font-family: var(--ylf-font-round);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.docs-route__copy {
  display: grid;
  gap: 0.2rem;
}

.docs-route__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 0.95rem;
  line-height: 1.4;
}

.docs-route__copy small {
  color: var(--ui-text-muted);
  font-size: 0.8rem;
  line-height: 1.5;
}

.docs-route__arrow {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 9999px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-dimmed);
  transition:
    transform 200ms var(--docs-ease),
    background-color 200ms ease,
    color 200ms ease;
}

.docs-route__icon {
  width: 0.95rem;
  height: 0.95rem;
}

.docs-route__link:hover .docs-route__arrow {
  transform: translate(2px, -2px);
  background: color-mix(in srgb, var(--ui-primary) 12%, var(--ui-bg-muted));
  color: var(--ui-primary);
}

.docs-content {
  position: relative;
  z-index: 3;
  padding-top: clamp(1.5rem, 5vw, 4rem);
}

.docs-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(2rem, 5vw, 4rem);
  align-items: start;
}

.docs-article {
  min-width: 0;
  max-width: 52rem;
  margin-inline: auto;
  border: 1px solid color-mix(in srgb, var(--ui-border) 76%, transparent);
  border-radius: clamp(1.25rem, 3vw, 1.75rem);
  padding: clamp(1.25rem, 4vw, 3.25rem);
  background: color-mix(in srgb, var(--ui-bg-elevated) 96%, transparent);
  box-shadow: var(--docs-shadow);
}

.docs-mobile-nav {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1.25rem;
  padding: 1rem;
  background: color-mix(in srgb, var(--ui-bg-elevated) 94%, transparent);
  box-shadow: 0 1rem 3rem -2.5rem color-mix(in srgb, var(--ui-text-highlighted) 32%, transparent);
}

.docs-mobile-nav__label {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--ui-text-highlighted);
  font-size: 0.75rem;
  font-weight: 750;
  letter-spacing: 0.04em;
}

.docs-mobile-nav__label svg {
  width: 1rem;
  height: 1rem;
  color: var(--ui-primary);
}

.docs-mobile-nav__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.docs-mobile-nav__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 76%, transparent);
  border-radius: 9999px;
  padding: 0.55rem 0.8rem;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
  font-size: 0.78rem;
  font-weight: 650;
  touch-action: manipulation;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    color 180ms ease;
}

.docs-mobile-nav__link:hover,
.docs-mobile-nav__link:focus-visible {
  border-color: color-mix(in srgb, var(--ui-primary) 42%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ui-bg-muted));
  color: var(--ui-primary);
}

.docs-prose :deep(> p:first-child) {
  color: var(--ui-text-toned);
  font-size: clamp(1.05rem, 2vw, 1.15rem);
  line-height: 1.85;
}

.docs-prose :deep(h2),
.docs-prose :deep(h3) {
  scroll-margin-top: calc(var(--ui-header-height) + 1.5rem);
  text-wrap: balance;
}

.docs-prose :deep(h2) {
  position: relative;
  padding-left: 1rem;
}

.docs-prose :deep(h2)::before {
  position: absolute;
  top: 0.18em;
  bottom: 0.12em;
  left: 0;
  width: 0.25rem;
  border-radius: 9999px;
  background: var(--ylf-gradient-brand);
  content: '';
}

.docs-prose :deep(a) {
  text-decoration-color: color-mix(in srgb, var(--ui-primary) 38%, transparent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
  transition:
    color 160ms ease,
    text-decoration-color 160ms ease;
}

.docs-prose :deep(a:hover) {
  text-decoration-color: currentColor;
}

.docs-prose :deep(li::marker) {
  color: color-mix(in srgb, var(--ui-primary) 76%, var(--ui-text-muted));
  font-weight: 700;
}

.docs-page--featured .docs-prose :deep(ol) {
  display: grid;
  gap: 0.75rem;
  padding-left: 0;
  counter-reset: docs-step;
  list-style: none;
}

.docs-page--featured .docs-prose :deep(ol > li) {
  position: relative;
  min-height: 3.75rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1rem;
  padding: 0.9rem 1rem 0.9rem 3.75rem;
  background: color-mix(in srgb, var(--ui-bg-muted) 68%, transparent);
  counter-increment: docs-step;
}

.docs-page--featured .docs-prose :deep(ol > li)::before {
  position: absolute;
  top: 0.75rem;
  left: 0.85rem;
  display: grid;
  width: 2.1rem;
  height: 2.1rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 24%, transparent);
  border-radius: 0.7rem;
  background: color-mix(in srgb, var(--ui-primary) 10%, var(--ylf-surface));
  color: var(--ui-primary);
  content: counter(docs-step, decimal-leading-zero);
  font-family: var(--ylf-font-round);
  font-size: 0.7rem;
  font-weight: 800;
}

.docs-aside {
  display: none;
}

.docs-aside__panel {
  border: 1px solid color-mix(in srgb, var(--ui-border) 74%, transparent);
  border-radius: 1.25rem;
  padding: 1.1rem;
  background: color-mix(in srgb, var(--ui-bg-elevated) 94%, transparent);
  box-shadow: 0 1.25rem 3.5rem -2.75rem color-mix(in srgb, var(--ui-text-highlighted) 35%, transparent);
}

.docs-aside__section + .docs-aside__section {
  margin-top: 1.5rem;
  border-top: 1px solid var(--ui-border-muted);
  padding-top: 1.5rem;
}

.docs-aside__label {
  margin-bottom: 0.75rem;
  color: var(--ui-text-highlighted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.docs-aside :deep(a) {
  min-height: 2.5rem;
}

.docs-resource {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
  min-height: 3.75rem;
  border: 1px solid transparent;
  border-radius: 0.9rem;
  padding: 0.65rem;
  touch-action: manipulation;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    transform 180ms var(--docs-ease);
}

.docs-resource:hover {
  transform: translateX(2px);
  border-color: var(--ui-border-muted);
  background: color-mix(in srgb, var(--ui-bg-muted) 84%, transparent);
}

.docs-resource:active {
  transform: scale(0.99);
}

.docs-resource__icon-wrap {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, transparent);
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
}

.docs-resource__icon {
  width: 1rem;
  height: 1rem;
  color: var(--ui-primary);
}

.docs-resource span {
  display: grid;
  gap: 0.1rem;
}

.docs-resource strong {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
  color: var(--ui-text-highlighted);
  font-size: 0.82rem;
}

.docs-resource small {
  color: var(--ui-text-muted);
  font-size: 0.7rem;
  line-height: 1.45;
}

.docs-resource__external {
  width: 0.72rem;
  height: 0.72rem;
  color: var(--ui-text-dimmed);
}

@media (min-width: 768px) {
  .docs-route {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .docs-mobile-nav {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }
}

@media (min-width: 1024px) {
  .docs-hero__container {
    grid-template-columns: minmax(0, 1.35fr) minmax(21rem, 0.65fr);
  }

  .docs-route {
    grid-template-columns: minmax(0, 1fr);
  }

  .docs-page--featured .docs-content {
    margin-top: -2.25rem;
    padding-top: 0;
  }
}

@media (min-width: 1100px) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr) 14rem;
    gap: 2rem;
  }

  .docs-article {
    margin-inline: 0;
  }

  .docs-aside {
    position: sticky;
    top: calc(var(--ui-header-height) + 2rem);
    display: block;
  }

  .docs-mobile-nav {
    display: none;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .docs-hero__copy {
    animation: docs-enter 420ms var(--docs-ease) both;
  }

  .docs-route-panel {
    animation: docs-enter 460ms 70ms var(--docs-ease) both;
  }
}

@keyframes docs-enter {
  from {
    opacity: 0;
    transform: translateY(0.75rem);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .docs-route__link,
  .docs-route__arrow,
  .docs-resource,
  .docs-mobile-nav__link {
    transition: none;
  }

  .docs-route__link:hover,
  .docs-route__link:active,
  .docs-resource:hover,
  .docs-resource:active {
    transform: none;
  }
}
</style>
