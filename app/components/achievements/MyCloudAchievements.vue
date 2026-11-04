<script setup lang="ts">
import CloudAchievementCollection from './CloudAchievementCollection.vue'

const { collection, loading, saving, error, restricted, refresh, equip } = useCloudAchievements()
onUserSession(() => refresh())
</script>

<template>
  <p v-if="restricted" class="ylf-surface rounded-[var(--ylf-radius-lg)] p-5 text-sm text-muted" role="status">
    测试账号暂不支持云朵成就
  </p>
  <CloudAchievementCollection
    v-else
    :collection="collection"
    :editable="!restricted"
    :loading="loading"
    :saving="saving"
    :error="error"
    @refresh="refresh"
    @equip="equip"
  />
</template>
