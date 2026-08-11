<script setup lang="ts">
const supportCenterLink = 'https://support.yunle.fun/'
</script>

<template>
  <AppPageCard
    class="ylf-support-entry"
    title="云乐坊支持中心"
    description="搜索帮助、反馈问题、联系私密客服或查看服务状态。"
    icon="i-lucide-life-buoy"
    :to="supportCenterLink"
    variant="subtle"
  >
    <template #footer>
      <span class="ylf-support-entry__action">
        前往支持中心
        <Icon name="i-lucide-arrow-right" aria-hidden="true" />
      </span>
    </template>
  </AppPageCard>
</template>

<style scoped>
.ylf-support-entry {
  margin-block: 0 2rem;
}

.ylf-support-entry__action {
  display: inline-flex;
  gap: 0.4rem;
  align-items: center;
  color: var(--ui-primary);
  font-size: 0.875rem;
  font-weight: 700;
}

.ylf-support-entry__action svg {
  width: 1rem;
  height: 1rem;
}
</style>
