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
    version: item.enabled ? (item.platform === 'web' ? '无需下载' : item.version) : '正在开发中',
    link: item.enabled ? item.url : undefined,
    actionLabel: item.enabled ? (item.platform === 'web' ? '在线访问' : '下载应用') : '暂未开放',
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
  <div>
    <!-- Downloads Section -->
    <AppPageHero
      title="下载应用"
      description="选择适合您设备的版本，立即开始使用"
      class="pt-12 md:pt-16"
    >
      <template #headline>
        <div class="flex justify-center">
          <YlfEyebrow label="📥 立即下载" />
        </div>
      </template>
      <p v-if="downloadError" role="status" class="mb-4 text-center text-sm text-muted-foreground">
        暂时无法获取最新下载信息，您仍可使用网页版。
      </p>
      <AppPageGrid>
        <AppPageCard
          v-for="(platform, index) in platforms"
          :key="index"
          :title="platform.name"
          :description="platform.description"
          :icon="platform.icon"
        >
          <template #footer>
            <div class="flex flex-col gap-3">
              <div class="text-muted text-sm">
                <div>{{ platform.version }}</div>
                <div class="text-xs mt-1">
                  {{ platform.requirements }}
                </div>
              </div>
              <AppButton
                :to="platform.link"
                :target="platform.isWeb ? '_blank' : undefined"
                :rel="platform.isWeb ? 'noopener noreferrer' : undefined"
                :disabled="!platform.link"
                :color="platform.color"
                variant="solid"
                block
                :icon="platform.isWeb ? 'i-lucide-external-link' : 'i-lucide-download'"
              >
                {{ platform.actionLabel }}
              </AppButton>
            </div>
          </template>
        </AppPageCard>
      </AppPageGrid>
    </AppPageHero>

    <AppSeparator />

    <!-- Features Section -->
    <AppPageSection
      id="features"
      title="为什么选择我们"
      description="强大的功能，卓越的体验"
    >
      <template #headline>
        <div class="flex justify-center">
          <YlfEyebrow label="✨ 核心特性" />
        </div>
      </template>
      <AppPageGrid>
        <AppPageCard
          v-for="(feature, index) in features"
          :key="index"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
          variant="subtle"
        />
      </AppPageGrid>
    </AppPageSection>

    <AppSeparator />

    <!-- FAQ Section -->
    <AppPageSection
      title="常见问题"
      description="关于下载和使用应用的常见问题解答"
    >
      <template #headline>
        <div class="flex justify-center">
          <YlfEyebrow label="❓ 常见问题" />
        </div>
      </template>
      <AppAccordion
        :items="faqItems"
        :unmount-on-hide="false"
        type="single"
        class="mx-auto max-w-3xl"
        :ui="{
          trigger: 'text-base text-highlighted',
          body: 'text-base text-muted',
        }"
      />
    </AppPageSection>
  </div>
</template>
