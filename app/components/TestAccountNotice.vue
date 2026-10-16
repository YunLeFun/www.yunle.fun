<script setup lang="ts">
const props = defineProps<{
  /** Unsupported feature identified by the account service. */
  feature: 'reward-history' | 'ai-point-exchange' | 'sign-in' | 'profile-sync' | 'notifications'
}>()
const notices = {
  'reward-history': {
    title: '测试账号暂不支持奖励历史',
    description: '此账号用于业务调试，不参与正式奖励。你仍可查看云币余额和明细。',
  },
  'ai-point-exchange': {
    title: '测试账号暂不支持 AI 点数兑换',
    description: '此账号可查看已有 AI 点数和流水，暂不支持使用云币兑换点数。',
  },
  'sign-in': {
    title: '测试账号暂不支持签到奖励',
    description: '此账号用于业务调试，不参与每日签到或领取云币奖励。你仍可查看账户余额和明细。',
  },
  'profile-sync': {
    title: '测试账号暂不支持公开资料同步',
    description: '此账号的资料更新不会同步到公开主页；登录和账户读取不受影响。',
  },
  'notifications': {
    title: '测试账号暂不支持站内通知',
    description: '此账号暂不提供通知未读数、通知列表和已读标记。登录和账户读取不受影响。',
  },
}
const notice = computed(() => notices[props.feature])
</script>

<template>
  <div class="flex items-start gap-3 rounded-xl border border-default bg-muted/30 p-4" role="status" :data-testid="`test-account-${feature}`">
    <Icon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-muted" />
    <div class="space-y-1">
      <p class="text-sm font-medium text-highlighted">
        {{ notice.title }}
      </p>
      <p class="text-sm leading-6 text-muted">
        {{ notice.description }}
      </p>
    </div>
  </div>
</template>
