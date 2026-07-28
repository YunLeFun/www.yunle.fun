interface AvatarUploadResult {
  fileID: string
  cloudPath: string
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string')
        resolve(reader.result)
      else reject(new Error('读取头像失败'))
    }
    reader.onerror = () => reject(reader.error || new Error('读取头像失败'))
    reader.readAsDataURL(file)
  })
}

function isAvatarUploadResult(value: unknown): value is AvatarUploadResult {
  if (!value || typeof value !== 'object')
    return false
  const item = value as Record<string, unknown>
  return typeof item.fileID === 'string'
    && typeof item.cloudPath === 'string'
}

export function useAvatarUpload() {
  const { app } = useCloudbase()

  async function uploadAvatar(file: File): Promise<AvatarUploadResult> {
    if (!app)
      throw new Error('头像上传服务不可用')

    const data = await readFileAsDataUrl(file)
    const res = await app.callFunction({
      name: 'account-api',
      data: {
        action: 'uploadAvatar',
        avatar: {
          contentType: file.type || 'image/jpeg',
          data,
        },
      },
    })
    if (!isAvatarUploadResult(res.result))
      throw new Error('头像上传失败')
    return res.result
  }

  return { uploadAvatar }
}
