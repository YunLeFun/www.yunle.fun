<script setup lang="ts">
import type {
  RewardClaimAvailability,
  RewardClaimCampaignView,
  RewardClaimResult,
} from '~/types/reward-claim'
import {
  CheckCircle2Icon,
  Clock3Icon,
  CloudSunIcon,
  CoinsIcon,
  GiftIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  TicketCheckIcon,
} from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

definePageMeta({ layout: false })

useSeoMeta({
  title: '领取云乐坊礼遇',
  description: '登录云乐坊账号并主动领取活动权益',
  robots: 'noindex, nofollow, noarchive',
})
useHead({
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})

const route = useRoute()
const token = computed(() => route.hash.startsWith('#') ? route.hash.slice(1) : '')
const { user, isAuthenticated, authReady, checkAuthStatus } = useTcbAuthSession()
const rewardClaim = useRewardClaim()

const view = ref<RewardClaimCampaignView | null>(null)
const localClaim = ref<RewardClaimResult | null>(null)
const pageError = ref('')
const fetching = ref(false)

const claim = computed(() => localClaim.value ?? view.value?.viewer.claim ?? null)
const campaign = computed(() => view.value?.campaign)
const availability = computed<RewardClaimAvailability>(
  () => view.value?.availability ?? 'unavailable',
)
const canClaim = computed(() =>
  availability.value === 'active'
  && isAuthenticated.value
  && (!claim.value || claim.value.status === 'failed')
  && !rewardClaim.claiming.value,
)
const loginUrl = computed(() =>
  `/login?redirect=${encodeURIComponent(route.fullPath)}`,
)

const rewardText = computed(() => {
  const reward = campaign.value?.reward
  if (!reward)
    return ''
  return [
    reward.coinAmount ? `${reward.coinAmount} 云币` : '',
    reward.membershipDays ? `${reward.membershipDays} 天会员` : '',
  ].filter(Boolean).join(' + ')
})

const availabilityCopy = computed(() => {
  const copies: Record<RewardClaimAvailability, { title: string, description: string }> = {
    unpublished: { title: '活动尚未开放', description: '请稍后再来看看。' },
    scheduled: { title: '活动尚未开始', description: '到开放时间后即可领取。' },
    active: { title: '礼遇可以领取', description: '登录后点击按钮，权益会发放到当前账户。' },
    paused: { title: '活动暂时暂停', description: '暂时不能发起新的领取，请稍后再试。' },
    ended: { title: '活动已结束', description: '感谢你的关注，已到账权益不受影响。' },
    expired: { title: '活动已结束', description: '领取时间已经结束，已到账权益不受影响。' },
    exhausted: { title: '奖励已领完', description: '本次活动库存已经全部领取。' },
    unavailable: { title: '领取链接不可用', description: '链接可能已失效或被替换，请向活动发布者确认。' },
  }
  return copies[availability.value]
})

function formatChinaTime(value?: number) {
  if (!Number.isFinite(value))
    return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value!))
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : ''
  if (/已领完|已结束|已过期|已暂停|尚未开始|请先登录|不能领取/.test(raw))
    return raw
  return '领取暂未完成，请稍后重试；重复提交不会重复到账'
}

async function loadCampaign() {
  if (!token.value) {
    view.value = { availability: 'unavailable', viewer: { authenticated: false } }
    return
  }
  fetching.value = true
  pageError.value = ''
  try {
    view.value = await rewardClaim.inspect(token.value)
    localClaim.value = null
  }
  catch {
    view.value = { availability: 'unavailable', viewer: { authenticated: !!user.value } }
  }
  finally {
    fetching.value = false
  }
}

async function handleClaim() {
  if (!canClaim.value)
    return
  pageError.value = ''
  try {
    localClaim.value = await rewardClaim.claim(token.value)
  }
  catch (error) {
    const message = safeErrorMessage(error)
    await loadCampaign()
    pageError.value = message
  }
}

onMounted(async () => {
  if (!authReady.value)
    await checkAuthStatus()
  await loadCampaign()
})

watch(() => user.value?.id, (next, previous) => {
  if (next !== previous && authReady.value)
    void loadCampaign()
})
</script>

<template>
  <div
    data-slot="reward-claim-page"
    class="relative isolate min-h-dvh overflow-hidden bg-background"
  >
    <div class="pointer-events-none absolute inset-0" aria-hidden="true">
      <div class="absolute inset-x-0 top-0 h-[28rem] bg-gradient-to-b from-sky-100/80 via-blue-50/45 to-transparent dark:from-sky-950/35 dark:via-blue-950/15" />
      <div class="absolute -top-20 left-1/2 size-72 -translate-x-1/2 rounded-full bg-cyan-300/25 blur-3xl dark:bg-cyan-500/15" />
      <div class="absolute right-[-5rem] top-[38%] size-56 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/10" />
    </div>

    <main class="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:justify-center sm:px-6 sm:py-10">
      <NuxtLink
        to="/"
        class="mb-5 inline-flex w-fit items-center gap-2 rounded-full text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
      >
        <span class="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <CloudSunIcon class="size-4" aria-hidden="true" />
        </span>
        云乐坊
      </NuxtLink>

      <Card class="w-full gap-0 overflow-hidden rounded-[2rem] border-border/80 py-0 shadow-2xl shadow-slate-950/10 dark:shadow-black/25">
        <div v-if="fetching || !view" class="flex min-h-96 flex-col items-center justify-center gap-3 px-6 text-center">
          <Spinner class="size-7" />
          <p class="text-sm text-muted-foreground">
            正在确认领取信息
          </p>
        </div>

        <template v-else-if="campaign && availability !== 'unavailable'">
          <CardHeader class="relative border-b border-border/70 bg-gradient-to-br from-primary/13 via-card to-cyan-400/10 px-6 py-7 sm:px-8 sm:py-8">
            <div class="mb-5 flex items-center">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-background/80 px-3 py-1 text-xs font-semibold text-primary shadow-sm backdrop-blur">
                <GiftIcon class="size-3.5" aria-hidden="true" />
                云乐坊权益领取
              </span>
            </div>
            <CardTitle class="text-2xl leading-tight font-bold text-balance sm:text-3xl">
              <h1>{{ campaign.title }}</h1>
            </CardTitle>
            <CardDescription class="mt-2 text-sm leading-6">
              {{ campaign.description }}
            </CardDescription>
          </CardHeader>

          <CardContent class="space-y-5 px-6 py-6 sm:px-8">
            <div class="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-5 text-center">
              <CoinsIcon class="mx-auto mb-2 size-7 text-primary" aria-hidden="true" />
              <p class="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                本次礼遇
              </p>
              <p class="mt-1 text-2xl font-bold text-foreground">
                {{ rewardText }}
              </p>
            </div>

            <div class="grid gap-3 text-sm sm:grid-cols-2">
              <div class="flex items-start gap-2.5 rounded-xl bg-muted/70 px-4 py-3">
                <TicketCheckIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>每个账户限领一次</span>
              </div>
              <div class="flex items-start gap-2.5 rounded-xl bg-muted/70 px-4 py-3">
                <ShieldCheckIcon class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>领取后长期有效</span>
              </div>
            </div>

            <div class="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground">
              <Clock3Icon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                领取时间：{{ formatChinaTime(campaign.startsAt) }} 至 {{ formatChinaTime(campaign.endsAt) }}
              </span>
            </div>

            <Alert
              v-if="claim?.status === 'succeeded'"
              class="border-success/30 bg-success/8"
            >
              <CheckCircle2Icon class="text-success" aria-hidden="true" />
              <AlertTitle>领取成功</AlertTitle>
              <AlertDescription>
                权益已到账<span v-if="claim.balanceAfter !== undefined">，当前余额 {{ claim.balanceAfter }} 云币</span>。
              </AlertDescription>
            </Alert>

            <Alert
              v-else-if="claim?.status === 'processing'"
              class="border-primary/25 bg-primary/5"
            >
              <LoaderCircleIcon class="animate-spin text-primary" aria-hidden="true" />
              <AlertTitle>正在确认到账</AlertTitle>
              <AlertDescription>
                已为你保留库存，请稍后刷新查看；无需重复领取。
              </AlertDescription>
            </Alert>

            <Alert
              v-else-if="availability !== 'active'"
              :class="{ 'border-warning/30 bg-warning/8': availability === 'paused' || availability === 'scheduled' }"
            >
              <Clock3Icon aria-hidden="true" />
              <AlertTitle>{{ availabilityCopy.title }}</AlertTitle>
              <AlertDescription>{{ availabilityCopy.description }}</AlertDescription>
            </Alert>

            <Alert v-if="pageError" variant="destructive">
              <AlertTitle>暂未领取成功</AlertTitle>
              <AlertDescription>{{ pageError }}</AlertDescription>
            </Alert>
          </CardContent>

          <CardFooter class="flex-col gap-3 border-t border-border/70 bg-muted/35 px-6 py-5 sm:px-8">
            <Button
              v-if="canClaim"
              data-testid="claim-button"
              size="lg"
              class="h-12 w-full rounded-xl text-base font-semibold"
              :disabled="rewardClaim.claiming.value"
              @click="handleClaim"
            >
              <Spinner v-if="rewardClaim.claiming.value" />
              <GiftIcon v-else aria-hidden="true" />
              {{ rewardClaim.claiming.value ? '正在领取' : claim?.status === 'failed' ? '重新领取' : '确认领取' }}
            </Button>

            <Button
              v-else-if="availability === 'active' && !isAuthenticated && !claim"
              as-child
              size="lg"
              class="h-12 w-full rounded-xl text-base font-semibold"
            >
              <NuxtLink :to="loginUrl">
                登录后领取
              </NuxtLink>
            </Button>

            <p class="text-center text-xs leading-5 text-muted-foreground">
              点击领取即表示你确认将权益发放至当前登录账户
            </p>
          </CardFooter>
        </template>

        <div v-else class="flex min-h-[28rem] flex-col items-center justify-center px-7 py-12 text-center">
          <div class="mb-5 flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <TicketCheckIcon class="size-8" aria-hidden="true" />
          </div>
          <h1 class="text-xl font-bold">
            {{ availabilityCopy.title }}
          </h1>
          <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {{ availabilityCopy.description }}
          </p>
          <Button as-child variant="outline" class="mt-7 rounded-xl">
            <NuxtLink to="/">
              返回云乐坊
            </NuxtLink>
          </Button>
        </div>
      </Card>

      <p class="mt-5 text-center text-xs leading-5 text-muted-foreground">
        请勿转发来源不明的领取链接 · 云乐坊不会索要密码或验证码
      </p>
    </main>
  </div>
</template>
