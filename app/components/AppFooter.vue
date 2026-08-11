<script setup lang="ts">
import { Separator } from '@/components/ui/separator'
import { socialList } from '~/config'
import YlfLogo from './ylf/Logo.vue'

const columns = [{
  label: '资源',
  children: [{
    label: '网站地图',
    to: '/docs/sitemap/',
  }, {
    label: '帮助',
    to: '/docs/',
  }, {
    label: '支持中心',
    to: 'https://support.yunle.fun/',
  }, {
    label: '博客',
    to: '/blog',
  }, {
    label: '日志',
    to: '/changelog',
  }],
}, {
  label: '开发者',
  children: [
    {
      label: '应用生态状态',
      to: '/developer',
    },
    {
      label: '开发者文档',
      to: 'https://docs.yunle.fun',
      target: '_blank',
    },
    {
      label: 'GitHub',
      to: 'https://github.com/YunLeFun',
      target: '_blank',
    },
  ],
}, {
  label: '关于',
  children: [
    {
      label: '服务协议',
      to: '/docs/terms-of-service',
    },
    {
      label: '隐私政策',
      to: '/docs/privacy-policy',
    },
    {
      label: '联系我们',
      to: '/docs/contact',
    },
  ],
}]

// const toast = useAppToast()

// const email = ref('')
// const loading = ref(false)

// function onSubmit() {
//   loading.value = true

//   toast.add({
//     title: 'Subscribed!',
//     description: 'You\'ve been subscribed to our newsletter.',
//   })
// }
</script>

<template>
  <div class="relative flex items-center justify-center" aria-hidden="true">
    <Separator />
    <span class="absolute inline-flex rounded-full border border-border bg-background px-3 py-1.5">
      <YlfLogo class="h-4 w-auto" />
    </span>
  </div>

  <footer>
    <div class="border-b border-border">
      <AppContainer class="grid gap-8 py-10 sm:grid-cols-3 sm:py-12">
        <section v-for="column in columns" :key="column.label" class="flex flex-col gap-3">
          <h2 class="text-sm font-semibold text-foreground">
            {{ column.label }}
          </h2>
          <nav class="flex flex-col gap-2" :aria-label="column.label">
            <NuxtLink
              v-for="item in column.children"
              :key="item.to"
              :to="item.to"
              :target="item.target"
              :rel="item.target === '_blank' ? 'noopener noreferrer' : undefined"
              class="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {{ item.label }}
            </NuxtLink>
          </nav>
        </section>
      </AppContainer>
    </div>

    <AppContainer class="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-col gap-1 text-sm text-muted-foreground">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="w-fit hover:underline">苏ICP备2023020936号</a>
        <p>© {{ new Date().getFullYear() }} 云乐坊信息技术工作室</p>
      </div>

      <div class="flex items-center gap-1">
        <AppButton
          v-for="item in socialList" :key="item.to" :to="item.to" target="_blank" rel="noopener noreferrer" :icon="item.icon"
          :aria-label="item.title" color="neutral" variant="ghost" :title="item.title"
        />
      </div>
    </AppContainer>
  </footer>
</template>
