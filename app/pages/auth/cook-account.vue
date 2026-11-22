<script setup lang="ts">
import { useCookAccountHandoff } from '~/composables/auth/useCookAccountHandoff'

definePageMeta({ layout: 'auth' })
useSeoMeta({ title: '连接云乐坊账号' })

const { state, switchAccount, cancelSwitch } = useCookAccountHandoff()
</script>

<template>
  <section v-if="state === 'switch'" class="space-y-4" aria-labelledby="cook-switch-title">
    <h1 id="cook-switch-title" class="text-xl font-semibold">
      切换网页账号？
    </h1>
    <p class="text-sm text-muted-foreground">
      网页已登录另一个云乐坊账号。要切换到云食册正在使用的账号吗？
    </p>
    <div class="flex flex-wrap gap-2">
      <AppButton @click="switchAccount">
        确认切换
      </AppButton>
      <AppButton color="neutral" variant="outline" @click="cancelSwitch">
        取消
      </AppButton>
    </div>
  </section>
  <p v-else-if="state === 'cancelled'" role="status" class="text-sm">
    已保留原来的网页登录状态，可以关闭网页返回云食册。
  </p>
  <p v-else-if="state === 'failed'" role="alert" class="text-sm">
    暂时无法打开云乐坊网页。请关闭网页，从云食册重试。
  </p>
  <p v-else role="status" class="text-sm text-muted-foreground">
    正在连接云乐坊账号…
  </p>
</template>
