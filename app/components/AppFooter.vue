<script setup lang="ts">
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

// const toast = useToast()

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
  <USeparator :icon="YlfLogo" class="h-px" />

  <UFooter :ui="{ top: 'border-b border-default' }">
    <template #top>
      <UContainer>
        <UFooterColumns :columns="columns">
          <!-- <template #right>
            <form @submit.prevent="onSubmit">
              <UFormField name="email" label="Subscribe to our newsletter" size="lg">
                <UInput v-model="email" type="email" class="w-full" placeholder="Enter your email">
                  <template #trailing>
                    <UButton type="submit" size="xs" color="neutral" label="Subscribe" />
                  </template>
                </UInput>
              </UFormField>
            </form>
          </template> -->
        </UFooterColumns>
      </UContainer>
    </template>

    <template #left>
      <p>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" class="hover:underline">苏ICP备2023020936号</a>
      </p>

      <p class="text-muted text-sm">
        © {{ new Date().getFullYear() }} 云乐坊信息技术工作室
      </p>
    </template>

    <template #right>
      <UButton
        v-for="item in socialList" :key="item.to" :to="item.to" target="_blank" :icon="item.icon"
        :aria-label="item.title" color="neutral" variant="ghost" :title="item.title"
      />
    </template>
  </UFooter>
</template>
