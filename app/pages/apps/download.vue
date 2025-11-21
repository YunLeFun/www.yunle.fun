<script setup lang="ts">
const title = '下载应用'
const description = '在任何设备上下载并使用我们的应用，享受无缝的跨平台体验'

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})

defineOgImageComponent('Saas')

// 平台下载链接
const platforms = ref<{
  name: string
  icon: string
  description: string
  version: string
  link: string
  color: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  requirements: string
  isWeb: boolean
}[]>([
  {
    name: 'iOS',
    icon: 'i-simple-icons-apple',
    description: 'iPhone 和 iPad',
    version: '最新版本 2.0.0',
    link: '#',
    color: 'neutral',
    requirements: 'iOS 14.0 或更高版本',
    isWeb: false,
  },
  {
    name: 'Android',
    icon: 'i-simple-icons-android',
    description: 'Android 设备',
    version: '最新版本 2.0.0',
    link: '#',
    color: 'success',
    requirements: 'Android 8.0 或更高版本',
    isWeb: false,
  },
  {
    name: 'Web',
    icon: 'i-heroicons-globe-alt',
    description: '网页版',
    version: '无需下载',
    link: '#',
    color: 'primary',
    requirements: '现代浏览器',
    isWeb: true,
  },
])

// 特性列表
const features = ref([
  {
    icon: 'i-heroicons-bolt',
    title: '极速体验',
    description: '优化的性能，流畅的操作体验',
  },
  {
    icon: 'i-heroicons-shield-check',
    title: '安全可靠',
    description: '端到端加密，保护您的隐私数据',
  },
  {
    icon: 'i-heroicons-arrow-path',
    title: '自动同步',
    description: '跨设备实时同步，随时随地访问',
  },
  {
    icon: 'i-heroicons-device-phone-mobile',
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
    content: '应用会自动检查更新。您也可以在设置中手动检查更新。',
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
    <UPageSection
      title="下载应用"
      description="选择适合您设备的版本，立即开始使用"
      class="pt-12 md:pt-16"
    >
      <UPageGrid>
        <UPageCard
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
              <UButton
                :to="platform.link"
                :color="platform.color"
                variant="solid"
                block
                :icon="platform.isWeb ? 'i-heroicons-arrow-top-right-on-square' : 'i-heroicons-arrow-down-tray'"
              >
                {{ platform.isWeb ? '在线访问' : '下载' }}
              </UButton>
            </div>
          </template>
        </UPageCard>
      </UPageGrid>
    </UPageSection>

    <USeparator />

    <!-- Features Section -->
    <UPageSection
      id="features"
      title="为什么选择我们"
      description="强大的功能，卓越的体验"
    >
      <UPageGrid>
        <UPageCard
          v-for="(feature, index) in features"
          :key="index"
          :title="feature.title"
          :description="feature.description"
          :icon="feature.icon"
          variant="subtle"
        />
      </UPageGrid>
    </UPageSection>

    <USeparator />

    <!-- System Requirements -->
    <UPageSection
      title="系统要求"
      description="确保您的设备满足以下最低要求"
    >
      <div class="mx-auto max-w-3xl">
        <UPageCard variant="subtle">
          <div class="space-y-4">
            <div class="gap-6 grid md:grid-cols-2">
              <div>
                <h3 class="text-highlighted font-semibold mb-2">
                  移动设备
                </h3>
                <ul class="text-muted text-sm space-y-2">
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>iOS 14.0+ / Android 8.0+</span>
                  </li>
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>至少 2GB RAM</span>
                  </li>
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>500MB 可用存储空间</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 class="text-highlighted font-semibold mb-2">
                  桌面设备
                </h3>
                <ul class="text-muted text-sm space-y-2">
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>Windows 10+ / macOS 11+ / Linux</span>
                  </li>
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>至少 4GB RAM</span>
                  </li>
                  <li class="flex gap-2 items-start">
                    <UIcon name="i-heroicons-check-circle" class="text-primary mt-0.5 flex-shrink-0 h-5 w-5" />
                    <span>1GB 可用存储空间</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </UPageCard>
      </div>
    </UPageSection>

    <USeparator />

    <!-- FAQ Section -->
    <UPageSection
      title="常见问题"
      description="关于下载和使用应用的常见问题解答"
    >
      <UAccordion
        :items="faqItems"
        :unmount-on-hide="false"
        type="single"
        class="mx-auto max-w-3xl"
        :ui="{
          trigger: 'text-base text-highlighted',
          body: 'text-base text-muted',
        }"
      />
    </UPageSection>
  </div>
</template>
