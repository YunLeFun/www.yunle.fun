<script setup lang="ts">
import type { UpdateUserReq } from '@cloudbase/auth'
import {
  ArrowRightIcon,
  AtSignIcon,
  CameraIcon,
  CheckIcon,
  EyeOffIcon,
  IdCardIcon,
  ImageUpIcon,
  InfoIcon,
  MarsIcon,
  PencilIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  VenusIcon,
} from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  getUsernameUpdateErrorMessage,
  getUsernameValidationError,
  isTemporaryUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
} from '~/utils/username'

const props = withDefaults(defineProps<{
  startEditing?: boolean
}>(), {
  startEditing: false,
})

const emit = defineEmits<{
  editFinished: []
}>()

const { user, fetchUser, setUsername } = useTcbAuth()
const { uploadAvatar } = useAvatarUpload()
const toast = useAppToast()

const editing = ref(false)
const saving = ref(false)
const form = reactive({
  nickname: '',
  avatar: '',
  description: '',
  gender: '' as '' | 'MALE' | 'FEMALE',
})

const NICKNAME_MAX_LENGTH = 32
const DESCRIPTION_MAX_LENGTH = 200

const genderOptions = [
  { label: '保密', value: 'PRIVATE', icon: EyeOffIcon },
  { label: '男', value: 'MALE', icon: MarsIcon },
  { label: '女', value: 'FEMALE', icon: VenusIcon },
]

const genderSelection = computed({
  get: () => form.gender || 'PRIVATE',
  set: (value: string) => {
    form.gender = value === 'PRIVATE' ? '' : value as 'MALE' | 'FEMALE'
  },
})

const nicknameError = computed(() => {
  const nickname = form.nickname.trim()
  if (!nickname)
    return '请输入昵称'
  if (Array.from(nickname).length > NICKNAME_MAX_LENGTH)
    return `昵称不能超过 ${NICKNAME_MAX_LENGTH} 个字符`
  return ''
})

const genderValue = computed(() => user.value?.gender || 'PRIVATE')

const genderLabel = computed(() => {
  const opt = genderOptions.find(o => o.value === genderValue.value)
  return opt?.label || '保密'
})

const normalizedNickname = computed(() => form.nickname.trim())

const hasChanges = computed(() =>
  normalizedNickname.value !== (user.value?.nickname || '')
  || form.avatar !== (user.value?.avatar || '')
  || form.description !== (user.value?.description || '')
  || form.gender !== (user.value?.gender || ''),
)

// 头像上传相关
const avatarInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)

// 裁剪弹窗相关
const showCropper = ref(false)
const cropFile = ref<File | null>(null)
const avatarActionLabel = computed(() =>
  form.avatar || user.value?.avatar ? '更换头像' : '上传头像',
)

const AVATAR_MAX_SIZE = 10 * 1024 * 1024 // 原图限制放宽到 10MB（裁剪后会压缩）
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp'

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

function handleAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  // 校验文件大小
  if (file.size > AVATAR_MAX_SIZE) {
    toast.add({ title: '文件过大', description: '图片不能超过 10MB', color: 'error' })
    input.value = ''
    return
  }

  // 校验文件类型
  if (!AVATAR_ACCEPT.split(',').includes(file.type)) {
    toast.add({ title: '格式错误', description: '仅支持 JPG、PNG、GIF 或 WebP 图片', color: 'error' })
    input.value = ''
    return
  }

  // 打开裁剪弹窗
  cropFile.value = file
  showCropper.value = true
  input.value = ''
}

async function handleCropConfirm(croppedFile: File) {
  try {
    uploading.value = true
    uploadProgress.value = 0

    uploadProgress.value = 20
    const { fileID } = await uploadAvatar(croppedFile)
    uploadProgress.value = 100

    // 用户资料持久化稳定 fileID；展示时由 MemberAvatar 换取新的临时 URL。
    form.avatar = fileID
    toast.add({ title: '上传成功', description: '头像已上传，点击保存生效', color: 'success' })
  }
  catch (err: unknown) {
    console.error('上传头像失败:', err)
    toast.add({
      title: '上传失败',
      description: err instanceof Error ? err.message : '请稍后重试',
      color: 'error',
    })
  }
  finally {
    uploading.value = false
    uploadProgress.value = 0
    cropFile.value = null
  }
}

// 用户名设置相关
const showUsernameModal = ref(false)
const usernameInput = ref('')
const settingUsername = ref(false)
const usernameError = ref('')

// 系统临时用户名允许用户自行替换一次；用户确认后的正式用户名不可修改。
const hasUsername = computed(() => !!user.value?.login)
const hasTemporaryUsername = computed(() => isTemporaryUsername(user.value?.login))
const canChangeUsername = computed(() => !hasUsername.value || hasTemporaryUsername.value)

function onUsernameInputChange() {
  usernameInput.value = normalizeUsername(usernameInput.value)
  usernameError.value = getUsernameValidationError(usernameInput.value)
}

function openUsernameModal() {
  usernameInput.value = ''
  usernameError.value = ''
  showUsernameModal.value = true
}

async function confirmSetUsername() {
  usernameInput.value = normalizeUsername(usernameInput.value)
  const err = getUsernameValidationError(usernameInput.value)
  if (err) {
    usernameError.value = err
    return
  }

  try {
    settingUsername.value = true
    await setUsername(usernameInput.value)
    showUsernameModal.value = false
  }
  catch (err: unknown) {
    usernameError.value = getUsernameUpdateErrorMessage(err)
  }
  finally {
    settingUsername.value = false
  }
}

function resetForm() {
  form.nickname = user.value?.nickname || ''
  form.avatar = user.value?.avatar || ''
  form.description = user.value?.description || ''
  form.gender = user.value?.gender || ''
}

watch(user, (u) => {
  if (u)
    resetForm()
}, { immediate: true })

function startEdit() {
  resetForm()
  editing.value = true
}

function cancelEdit() {
  resetForm()
  editing.value = false
  emit('editFinished')
}

watch(() => props.startEditing, (requested) => {
  if (requested && !editing.value) {
    startEdit()
  }
  else if (!requested && editing.value) {
    resetForm()
    editing.value = false
  }
}, { immediate: true })

async function save() {
  if (saving.value || nicknameError.value)
    return

  try {
    saving.value = true
    const { auth } = useCloudbase()
    const updateData: UpdateUserReq = {}

    if (normalizedNickname.value !== (user.value?.nickname || '')) {
      updateData.nickname = normalizedNickname.value
    }
    if (form.avatar !== (user.value?.avatar || '')) {
      updateData.avatar_url = form.avatar
    }
    if (form.description !== (user.value?.description || '')) {
      (updateData as Record<string, unknown>).description = form.description
    }
    if (form.gender !== (user.value?.gender || '')) {
      (updateData as Record<string, unknown>).gender = form.gender || undefined
    }

    if (Object.keys(updateData).length === 0) {
      editing.value = false
      emit('editFinished')
      return
    }

    const { error: updateError } = await auth.updateUser(updateData)
    if (updateError)
      throw updateError

    await fetchUser()
    editing.value = false
    emit('editFinished')

    toast.add({
      title: '保存成功',
      description: '个人资料已更新',
      color: 'success',
    })
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('保存资料失败:', err)
    toast.add({
      title: '保存失败',
      description: message || '请稍后重试',
      color: 'error',
    })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <form
      v-if="editing"
      aria-label="编辑个人资料"
      class="ylf-profile-editor overflow-hidden rounded-[1.75rem]"
      @submit.prevent="save"
    >
      <header class="ylf-profile-editor__divider flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-7 sm:py-6">
        <div class="flex min-w-0 items-start gap-3">
          <span class="ylf-icon-tile mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl">
            <IdCardIcon />
          </span>
          <div>
            <h2 class="font-heading text-lg font-semibold text-foreground">
              公开资料
            </h2>
            <p class="mt-1 text-sm leading-6 text-muted-foreground">
              保存后会同步显示在你的个人主页和社区内容中
            </p>
          </div>
        </div>
        <Badge variant="secondary" class="shrink-0 text-primary">
          编辑中
        </Badge>
      </header>

      <div class="grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside class="ylf-profile-editor__avatar ylf-profile-editor__divider flex flex-col items-center border-b px-6 py-8 text-center lg:border-r lg:border-b-0">
          <div class="relative">
            <MemberAvatar
              :src="form.avatar || undefined"
              :alt="user?.nickname || user?.login || 'User'"
              size="3xl"
              ring-class="ring-(color:--ylf-surface)"
            />
            <button
              type="button"
              :aria-label="avatarActionLabel"
              :title="avatarActionLabel"
              class="absolute inset-0 rounded-full transition-colors duration-150 hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              :disabled="uploading"
              @click="triggerAvatarUpload"
            >
              <span class="absolute -right-1 -bottom-1 flex size-9 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-sm">
                <CameraIcon v-if="!uploading" />
                <span v-else class="text-[10px] font-semibold tabular-nums">{{ uploadProgress }}%</span>
              </span>
            </button>
            <input
              ref="avatarInput"
              type="file"
              :accept="AVATAR_ACCEPT"
              class="hidden"
              @change="handleAvatarChange"
            >
          </div>

          <Button
            variant="outline"
            type="button"
            class="mt-5"
            :disabled="uploading"
            @click="triggerAvatarUpload"
          >
            <Spinner v-if="uploading" data-icon="inline-start" />
            <ImageUpIcon v-else data-icon="inline-start" />
            {{ uploading ? `上传中 ${uploadProgress}%` : avatarActionLabel }}
          </Button>
          <p class="mt-3 text-xs leading-5 text-muted-foreground">
            JPG、PNG、GIF 或 WebP<br>
            图片大小不超过 10MB
          </p>
        </aside>

        <div class="min-w-0 px-5 py-6 sm:px-7 sm:py-8">
          <FieldGroup class="gap-7">
            <Field :data-invalid="!!nicknameError">
              <FieldLabel for="profile-nickname">
                昵称
              </FieldLabel>
              <FieldDescription>
                这是其他人最先看到的名字
              </FieldDescription>
              <InputGroup :data-invalid="!!nicknameError">
                <InputGroupInput
                  id="profile-nickname"
                  v-model="form.nickname"
                  name="nickname"
                  placeholder="输入您的昵称"
                  autocomplete="nickname"
                  :maxlength="NICKNAME_MAX_LENGTH"
                  :aria-invalid="!!nicknameError"
                />
                <InputGroupAddon>
                  <UserRoundIcon />
                </InputGroupAddon>
              </InputGroup>
              <FieldError v-if="nicknameError">
                {{ nicknameError }}
              </FieldError>
            </Field>

            <Field>
              <div class="flex items-start justify-between gap-4">
                <div>
                  <FieldLabel for="profile-description">
                    个人介绍
                  </FieldLabel>
                  <FieldDescription>
                    简单介绍一下自己，也可以留空
                  </FieldDescription>
                </div>
                <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {{ form.description.length }}/{{ DESCRIPTION_MAX_LENGTH }}
                </span>
              </div>
              <Textarea
                id="profile-description"
                v-model="form.description"
                name="description"
                placeholder="分享你的兴趣、正在做的事……"
                :maxlength="DESCRIPTION_MAX_LENGTH"
                :rows="4"
                class="resize-none"
              />
            </Field>

            <FieldSet aria-labelledby="profile-gender-label">
              <FieldLegend id="profile-gender-label" variant="label">
                性别
              </FieldLegend>
              <FieldDescription>
                选择是否在公开资料中展示
              </FieldDescription>
              <ToggleGroup
                v-model="genderSelection"
                type="single"
                variant="outline"
                size="lg"
                :spacing="2"
                class="grid w-full grid-cols-3"
                aria-label="性别"
              >
                <ToggleGroupItem
                  v-for="opt in genderOptions"
                  :key="opt.value"
                  :value="opt.value"
                  :aria-label="`性别：${opt.label}`"
                  class="w-full"
                >
                  <component :is="opt.icon" data-icon="inline-start" />
                  {{ opt.label }}
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            <Field>
              <FieldLabel id="profile-username-label">
                用户名
              </FieldLabel>
              <FieldDescription>
                {{ hasTemporaryUsername ? '当前为系统生成，可自行修改一次' : '用于个人主页地址，确认后不可修改' }}
              </FieldDescription>
              <div class="ylf-profile-editor__secondary-row flex min-h-12 items-center justify-between gap-3 rounded-xl border bg-muted/45 px-4 py-2.5">
                <span v-if="hasUsername" class="min-w-0 truncate font-mono text-sm text-foreground">
                  @{{ user?.login }}
                </span>
                <span v-else class="text-sm text-muted-foreground">尚未设置</span>
                <Badge
                  v-if="hasUsername && !canChangeUsername"
                  variant="secondary"
                  class="shrink-0"
                >
                  不可修改
                </Badge>
                <Button
                  v-if="canChangeUsername"
                  variant="secondary"
                  size="sm"
                  type="button"
                  class="shrink-0 text-primary"
                  @click="openUsernameModal"
                >
                  <AtSignIcon data-icon="inline-start" />
                  {{ hasTemporaryUsername ? '修改用户名' : '设置用户名' }}
                </Button>
              </div>
            </Field>

            <NuxtLink
              to="/settings?tab=security"
              class="ylf-profile-editor__secondary-row group flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors duration-150 hover:bg-muted/60"
            >
              <span class="flex min-w-0 items-center gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <ShieldCheckIcon />
                </span>
                <span class="min-w-0">
                  <span class="block text-sm font-medium text-foreground">登录与安全</span>
                  <span class="mt-0.5 block truncate text-xs text-muted-foreground">手机号、邮箱和密码</span>
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
                管理
                <ArrowRightIcon class="transition-transform duration-150 group-hover:translate-x-0.5" />
              </span>
            </NuxtLink>
          </FieldGroup>
        </div>
      </div>

      <footer class="ylf-profile-editor__divider flex flex-col-reverse gap-3 border-t bg-muted/35 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p class="hidden text-xs text-muted-foreground sm:block">
          只有点击保存后，修改才会生效
        </p>
        <div class="grid grid-cols-2 gap-3 sm:flex">
          <Button
            variant="ghost"
            size="lg"
            type="button"
            class="sm:min-w-24"
            @click="cancelEdit"
          >
            取消
          </Button>
          <Button
            size="lg"
            type="submit"
            class="sm:min-w-30"
            :disabled="!hasChanges || !!nicknameError || uploading || saving"
          >
            <Spinner v-if="saving" data-icon="inline-start" />
            <CheckIcon v-else data-icon="inline-start" />
            {{ saving ? '保存中' : '保存修改' }}
          </Button>
        </div>
      </footer>
    </form>

    <section v-else class="ylf-profile-editor overflow-hidden rounded-[1.75rem]">
      <header class="ylf-profile-editor__divider flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-7 sm:py-6">
        <div>
          <h2 class="font-heading text-lg font-semibold text-foreground">
            个人资料
          </h2>
          <p class="mt-1 text-sm leading-6 text-muted-foreground">
            管理你在云乐坊公开展示的信息
          </p>
        </div>
        <Button as-child variant="secondary" size="sm" class="shrink-0 text-primary">
          <NuxtLink to="/settings?edit=profile">
            <PencilIcon data-icon="inline-start" />
            编辑
          </NuxtLink>
        </Button>
      </header>

      <div class="px-5 py-6 sm:px-7">
        <div class="flex items-center gap-4">
          <MemberAvatar
            :src="user?.avatar || undefined"
            :alt="user?.nickname || user?.login || 'User'"
            size="3xl"
            ring-class="ring-(color:--ylf-surface)"
          />
          <div class="min-w-0">
            <p class="truncate font-heading font-semibold text-foreground">
              {{ user?.nickname || '未设置昵称' }}
            </p>
            <p v-if="user?.login" class="mt-1 truncate font-mono text-sm text-muted-foreground">
              @{{ user.login }}
            </p>
          </div>
        </div>

        <dl class="mt-7">
          <div class="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
            <dt class="text-sm text-muted-foreground">
              个人介绍
            </dt>
            <dd class="text-sm leading-6 text-foreground whitespace-pre-wrap">
              {{ user?.description || '尚未填写' }}
            </dd>
          </div>
          <Separator />
          <div class="grid gap-1 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-4">
            <dt class="text-sm text-muted-foreground">
              性别
            </dt>
            <dd class="text-sm text-foreground">
              {{ genderLabel }}
            </dd>
          </div>
          <Separator />
          <div class="grid gap-2 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center sm:gap-4">
            <dt class="text-sm text-muted-foreground">
              用户名
            </dt>
            <dd class="flex items-center justify-between gap-3">
              <span v-if="hasUsername" class="flex min-w-0 items-center gap-2">
                <span class="truncate font-mono text-sm text-foreground">@{{ user?.login }}</span>
                <Badge v-if="hasTemporaryUsername" variant="secondary">临时</Badge>
              </span>
              <span v-else class="text-sm text-muted-foreground">尚未设置</span>
              <Button
                v-if="canChangeUsername"
                variant="secondary"
                size="sm"
                class="shrink-0 text-primary"
                @click="openUsernameModal"
              >
                <AtSignIcon data-icon="inline-start" />
                {{ hasTemporaryUsername ? '修改用户名' : '设置用户名' }}
              </Button>
            </dd>
          </div>
        </dl>

        <NuxtLink
          to="/settings?tab=security"
          class="ylf-profile-editor__secondary-row group mt-5 flex min-h-14 items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors duration-150 hover:bg-muted/60"
        >
          <span class="flex min-w-0 items-center gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ShieldCheckIcon />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-medium text-foreground">登录与安全</span>
              <span class="mt-0.5 block truncate text-xs text-muted-foreground">手机号、邮箱和密码</span>
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            管理
            <ArrowRightIcon class="transition-transform duration-150 group-hover:translate-x-0.5" />
          </span>
        </NuxtLink>
      </div>
    </section>

    <Dialog v-model:open="showUsernameModal">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ hasTemporaryUsername ? '修改用户名' : '设置用户名' }}</DialogTitle>
          <DialogDescription>
            用户名将用于你的个人主页地址
          </DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-5 px-6 pb-6">
          <Alert>
            <InfoIcon />
            <AlertTitle>{{ hasTemporaryUsername ? '临时用户名可修改一次' : '用户名设置后不可更改' }}</AlertTitle>
            <AlertDescription>
              {{ hasTemporaryUsername ? '这是系统生成的临时用户名，请设置你想长期使用的用户名；确认后将无法自行修改。' : '请仔细确认拼写，保存后将无法自行修改。' }}
            </AlertDescription>
          </Alert>

          <Field :data-invalid="!!usernameError">
            <FieldLabel for="profile-username-input">
              用户名
            </FieldLabel>
            <InputGroup :data-invalid="!!usernameError">
              <InputGroupInput
                id="profile-username-input"
                v-model="usernameInput"
                placeholder="请输入用户名"
                autocomplete="username"
                :maxlength="USERNAME_MAX_LENGTH"
                :aria-invalid="!!usernameError"
                @input="onUsernameInputChange"
              />
              <InputGroupAddon>
                <AtSignIcon />
              </InputGroupAddon>
            </InputGroup>
            <FieldError v-if="usernameError">
              {{ usernameError }}
            </FieldError>
            <div class="flex flex-col gap-1 text-xs text-muted-foreground">
              <p>· 6-20 个字符</p>
              <p>· 必须以小写字母开头</p>
              <p>· 只允许小写字母、数字、下划线（_）和连字符（-）</p>
            </div>
          </Field>
        </div>

        <DialogFooter>
          <DialogClose as-child>
            <Button variant="outline">
              取消
            </Button>
          </DialogClose>
          <Button
            :disabled="!!usernameError || !usernameInput || settingUsername"
            @click="confirmSetUsername"
          >
            <Spinner v-if="settingUsername" data-icon="inline-start" />
            <CheckIcon v-else data-icon="inline-start" />
            {{ settingUsername ? '保存中' : (hasTemporaryUsername ? '确认修改' : '确认设置') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 头像裁剪弹窗 -->
    <AvatarCropper
      v-model:open="showCropper"
      :file="cropFile"
      :max-size="512"
      :quality="0.85"
      @confirm="handleCropConfirm"
      @cancel="cropFile = null"
    />
  </div>
</template>

<style scoped>
.ylf-profile-editor {
  background: var(--card);
  color: var(--card-foreground);
  border: 1px solid var(--border);
  box-shadow: 0 20px 55px -42px color-mix(in srgb, var(--ylf-shadow-color) 32%, transparent);
}

.ylf-profile-editor__divider {
  border-color: var(--ylf-border-subtle);
}

.ylf-profile-editor__secondary-row {
  border-color: var(--input);
}

.ylf-profile-editor__secondary-row:hover {
  border-color: color-mix(in srgb, var(--primary) 32%, var(--input));
}

.ylf-profile-editor__avatar {
  background:
    radial-gradient(circle at 50% 18%, color-mix(in srgb, var(--primary) 9%, transparent), transparent 11rem),
    color-mix(in srgb, var(--muted) 72%, var(--card));
}

@media (prefers-reduced-motion: reduce) {
  .ylf-profile-editor * {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
  }
}
</style>
