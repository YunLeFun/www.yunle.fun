<script setup lang="ts">
import { socialList } from '~/config'
</script>

<template>
  <div
    inline-flex
    bg-black
    p-4
    text-2xl
  >
    <SocialIcons
      text="white"
      :social-list="socialList"
    />
  </div>
</template>
