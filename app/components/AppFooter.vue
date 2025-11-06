<script setup lang="ts">
import type { FooterColumn } from '@nuxt/ui'
import YlfLogo from './YlfLogo.vue'
import { socialList } from '~/config'

const columns: FooterColumn[] = [{
  label: '资源',
  children: [{
    label: '网站地图',
    to: '/docs/sitemap/'
  }, {
    label: '文档',
    to: '/docs/'
  }, {
    label: '博客',
    to: '/blog'
  }, {
    label: '日志',
    to: '/changelog'
  }]
}, {
  label: '关于',
  children: [
    {
      label: '服务协议',
      to: '/docs/terms-of-service'
    },
    {
      label: '隐私政策',
      to: '/docs/privacy-policy'
    },
    {
      label: '联系我们',
      to: '/docs/contact'
    }
  ]
}]

const toast = useToast()

const email = ref('')
const loading = ref(false)

function onSubmit() {
  loading.value = true

  toast.add({
    title: 'Subscribed!',
    description: 'You\'ve been subscribed to our newsletter.'
  })
}
</script>

<template>
  <USeparator :icon="YlfLogo" class="h-px" />

  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #top>
      <UContainer>
        <UFooterColumns :columns="columns">
          <template #right>
            <form @submit.prevent="onSubmit">
              <UFormField name="email" label="Subscribe to our newsletter" size="lg">
                <UInput v-model="email" type="email" class="w-full" placeholder="Enter your email">
                  <template #trailing>
                    <UButton type="submit" size="xs" color="neutral" label="Subscribe" />
                  </template>
                </UInput>
              </UFormField>
            </form>
          </template>
        </UFooterColumns>
      </UContainer>
    </template>

    <template #left>
      <p>
        苏ICP备2023020936号
      </p>

      <p class="text-muted text-sm">
        © {{ new Date().getFullYear() }} 云乐坊信息技术工作室
      </p>
    </template>

    <template #right>
      <UButton v-for="item in socialList" :key="item.to" :to="item.to" target="_blank" :icon="item.icon"
        :aria-label="item.title" color="neutral" variant="ghost" :title="item.title" />
    </template>
  </UFooter>
</template>
