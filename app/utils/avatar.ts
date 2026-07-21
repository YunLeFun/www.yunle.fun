const CLOUDBASE_FILE_ID_PREFIX = 'cloud://'
const AVATAR_PATH_PREFIX = '/avatars/'

/**
 * Convert one of our legacy signed CloudBase avatar URLs back to its durable
 * file ID. Third-party/OAuth avatar URLs are intentionally left untouched.
 */
export function toCloudbaseAvatarFileID(value: string | null | undefined, envId: string): string | null {
  const source = value?.trim()
  if (!source)
    return null
  if (source.startsWith(CLOUDBASE_FILE_ID_PREFIX))
    return source
  if (!envId)
    return null

  try {
    const url = new URL(source)
    const pathname = decodeURIComponent(url.pathname)
    if (!pathname.startsWith(AVATAR_PATH_PREFIX))
      return null

    const tcbSuffix = '.tcb.qcloud.la'
    const cosMarker = '.cos.'
    const bucket = url.hostname.endsWith(tcbSuffix)
      ? url.hostname.slice(0, -tcbSuffix.length)
      : url.hostname.includes(cosMarker)
        ? url.hostname.slice(0, url.hostname.indexOf(cosMarker))
        : ''

    return bucket ? `cloud://${envId}.${bucket}${pathname}` : null
  }
  catch {
    return null
  }
}

export function normalizeAvatarSource(value: string | null | undefined, envId: string): string | null {
  const source = value?.trim()
  if (!source)
    return null
  return toCloudbaseAvatarFileID(source, envId) || source
}
