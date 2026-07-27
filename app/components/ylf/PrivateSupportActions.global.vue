<script setup lang="ts">
const wxKfLink = 'https://work.weixin.qq.com/kfid/kfc9d4dcc4b6bd1c69e'
const privateSupportLink = 'https://support.yunle.fun/contact'
</script>

<template>
  <div class="ylf-private-support-actions">
    <UButton
      color="primary"
      icon="i-lucide-mail"
      :to="privateSupportLink"
    >
      准备客服邮件
    </UButton>

    <UButton
      color="success"
      variant="soft"
      icon="i-ri:customer-service-2-line"
      :to="wxKfLink"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="打开企业微信客服（在新窗口打开）"
    >
      打开企业微信客服
      <UIcon name="i-lucide-external-link" aria-hidden="true" />
    </UButton>
  </div>
</template>

<style scoped>
.ylf-private-support-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block: 1rem 1.25rem;
}
</style>
