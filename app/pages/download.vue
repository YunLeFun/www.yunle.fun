<script setup lang="ts">
import type { Downloads } from '~~/shared/public-content'
import { defaultDownloads } from '~~/shared/public-content'

const { data: publishedDownloads, error: downloadError } = usePublicContent('downloads')
const platformPresentation = {
  ios: { name: 'iOS', icon: 'i-ri-apple-fill', description: 'iPhone 和 iPad', color: 'neutral' as const },
  android: { name: 'Android', icon: 'i-ri-android-fill', description: 'Android 设备', color: 'success' as const },
  web: { name: 'Web', icon: 'i-lucide-globe', description: '网页版', color: 'primary' as const },
}
const platforms = computed(() => {
  const manifest = publishedDownloads.value?.content as Downloads | undefined
  return (manifest || defaultDownloads).items.map(item => ({
    ...platformPresentation[item.platform],
    isApple: item.platform === 'ios',
    version: item.enabled ? (item.platform === 'web' ? '无需下载' : item.version) : '正在开发中',
    link: item.enabled ? item.url : undefined,
    actionLabel: item.enabled ? (item.platform === 'web' ? '在线访问' : item.platform === 'ios' ? '前往 App Store' : '下载应用') : '暂未开放',
    requirements: item.requirements,
    isWeb: item.platform === 'web',
  }))
})

const title = '下载应用'
const description = '在任何设备上下载并使用我们的应用，享受无缝的跨平台体验'

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

// defineOgImageComponent('Saas') // Disabled: SSR is required for OG images

// 特性列表
const features = ref([
  {
    icon: 'i-lucide-zap',
    title: '极速体验',
    description: '优化的性能，流畅的操作体验',
  },
  {
    icon: 'i-lucide-shield-check',
    title: '安全可靠',
    description: '端到端加密，保护您的隐私数据',
  },
  {
    icon: 'i-lucide-refresh-cw',
    title: '自动同步',
    description: '跨设备实时同步，随时随地访问',
  },
  {
    icon: 'i-lucide-monitor-smartphone',
    title: '跨平台支持',
    description: '支持所有主流操作系统和设备',
  },
])

// FAQ
const faqItems = ref([
  {
    label: '应用是免费的吗？',
    content: '是的，我们的应用提供免费版本。高级功能需要订阅专业版。',
  },
  {
    label: '如何更新应用？',
    content: '您可以在本页查看已开放平台的最新版本，或通过对应应用商店检查更新。',
  },
  {
    label: '支持哪些语言？',
    content: '目前支持简体中文、繁体中文、英语等多种语言。',
  },
  {
    label: '遇到问题怎么办？',
    content: '您可以访问帮助中心或联系我们的客服团队获取支持。',
  },
])
</script>

<template>
  <div class="download-page">
    <!-- Downloads Section -->
    <AppPageHero
      title="下载应用"
      description="选择适合您设备的版本，立即开始使用"
      class="download-hero pt-12 md:pt-16"
    >
      <template #top>
        <div class="download-aurora" aria-hidden="true" />
      </template>
      <template #title>
        下载应用<span class="download-title-dot">.</span>
      </template>
      <p v-if="downloadError" role="status" class="mb-4 text-center text-sm text-muted-foreground">
        暂时无法获取最新下载信息，您仍可使用网页版。
      </p>
      <AppPageGrid class="download-platforms">
        <AppPageCard
          v-for="(platform, index) in platforms"
          :key="index"
          class="download-platform"
          :class="{ 'download-platform--available': platform.link }"
          :title="platform.name"
          :description="platform.description"
          :icon="platform.icon"
        >
          <template #footer>
            <div class="flex w-full flex-col gap-5">
              <div class="text-muted-foreground text-sm">
                <div class="download-status" :class="{ 'download-status--available': platform.link }">
                  <span aria-hidden="true" />{{ platform.version }}
                </div>
                <div class="text-xs mt-1">
                  {{ platform.requirements }}
                </div>
              </div>
              <AppButton
                :to="platform.link"
                :target="(platform.isWeb || platform.isApple) ? '_blank' : undefined"
                :rel="(platform.isWeb || platform.isApple) ? 'noopener noreferrer' : undefined"
                :disabled="!platform.link"
                :color="platform.link ? 'primary' : 'neutral'"
                size="lg"
                variant="solid"
                block
                :icon="platform.isApple ? 'i-ri-apple-fill' : platform.isWeb ? 'i-lucide-external-link' : 'i-lucide-download'"
              >
                {{ platform.actionLabel }}
              </AppButton>
            </div>
          </template>
        </AppPageCard>
      </AppPageGrid>
    </AppPageHero>

    <AppContainer><AppSeparator class="download-divider" /></AppContainer>

    <!-- Features Section -->
    <AppPageSection
      id="features"
      title="为什么选择我们"
      description="强大的功能，卓越的体验"
    >
      <div class="download-features">
        <AppPageCard
          v-for="(feature, index) in features"
          :key="index"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
          class="download-feature"
          variant="subtle"
        />
      </div>
    </AppPageSection>

    <AppContainer><AppSeparator class="download-divider" /></AppContainer>

    <!-- FAQ Section -->
    <AppPageSection
      title="常见问题"
      description="关于下载和使用应用的常见问题解答"
    >
      <AppAccordion
        :items="faqItems"
        :unmount-on-hide="false"
        type="single"
        class="download-faq mx-auto w-full max-w-3xl"
        :ui="{
          trigger: 'text-base text-foreground',
          body: 'text-base text-muted-foreground',
        }"
      />
    </AppPageSection>
  </div>
</template>

<style>
.download-page {
  --download-edge: var(--ylf-border-subtle);
  --download-glow: color-mix(in srgb, var(--ui-primary) 14%, transparent);
}

.download-aurora {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 24% 24%, var(--download-glow), transparent 55%),
    radial-gradient(ellipse at 80% 38%, color-mix(in srgb, var(--ylf-dopa-cyan) 10%, transparent), transparent 50%);
  mask-image: linear-gradient(#000 65%, transparent);
  animation: download-aurora 12s ease-in-out infinite alternate;
}

.download-title-dot {
  color: var(--ui-primary);
}

.download-platforms {
  max-width: 64rem;
  margin-inline: auto;
  gap: 1.25rem;
}

.download-platform {
  position: relative;
  padding-top: 1.75rem;
  border: 1px solid var(--download-edge);
  border-radius: 1.5rem;
  box-shadow: 0 12px 40px -28px var(--download-glow);
  --tw-ring-color: transparent;
  transition:
    transform 240ms ease,
    box-shadow 240ms ease,
    border-color 240ms ease;
}

.download-platform::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 85% 0%, var(--download-glow), transparent 65%);
  opacity: 0.4;
  transition: opacity 240ms ease;
}

.download-platform--available {
  border-color: color-mix(in srgb, var(--ui-primary) 40%, var(--download-edge));
  background: linear-gradient(145deg, color-mix(in srgb, var(--ui-primary) 5%, var(--ylf-surface)), var(--ylf-surface));
}

.download-platform--available::after {
  content: '';
  position: absolute;
  top: 0;
  left: 15%;
  width: 70%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ui-primary), var(--ylf-dopa-cyan), transparent);
}

.download-platform:focus-within {
  border-color: var(--ui-primary);
  box-shadow: 0 16px 44px -20px var(--download-glow);
}

@media (hover: hover) {
  .download-platform:hover {
    transform: translateY(-4px);
    border-color: color-mix(in srgb, var(--ui-primary) 38%, var(--download-edge));
    box-shadow: 0 20px 44px -22px var(--download-glow);
  }

  .download-platform:hover::before {
    opacity: 1;
  }
}

.download-platform [data-slot='card-header'] {
  padding-inline: 1.75rem;
}

.download-platform .ylf-icon-tile {
  width: 3rem;
  height: 3rem;
  margin-bottom: 0.5rem;
  border-radius: 1rem;
}

.download-platform [data-slot='card-footer'] {
  margin-top: auto;
  padding: 1.25rem 1.75rem 1.75rem;
  background: transparent;
  border-color: var(--download-edge);
}

.download-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.download-status > span {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--ui-text-dimmed);
}

.download-status--available > span {
  background: var(--ui-primary);
  box-shadow: 0 0 0 4px var(--download-glow);
}

.download-divider {
  background: linear-gradient(
    90deg,
    transparent,
    var(--download-edge) 25%,
    color-mix(in srgb, var(--ui-primary) 25%, var(--download-edge)) 50%,
    var(--download-edge) 75%,
    transparent
  );
}

.download-features {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.5rem;
}

.download-feature {
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}

.download-faq [data-slot='accordion-item'] {
  border-color: var(--download-edge);
}

.download-faq [data-slot='accordion-trigger'] {
  padding-block: 1.4rem;
  transition: color 180ms ease;
}

.download-faq [data-slot='accordion-trigger']:hover,
.download-faq [data-slot='accordion-trigger'][data-state='open'] {
  color: var(--ui-primary);
  text-decoration: none;
}

@media (max-width: 1023px) {
  .download-platforms {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .download-features {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .download-platforms,
  .download-features {
    grid-template-columns: minmax(0, 1fr);
  }

  .download-feature [data-slot='card-header'] {
    padding-inline: 0.5rem;
  }
}

@keyframes download-aurora {
  to {
    transform: translateY(1.5rem) scale(1.04);
  }
}

@media (prefers-reduced-motion: reduce) {
  .download-aurora {
    animation: none;
  }

  .download-platform {
    transition: none;
    transform: none;
  }
}
</style>
