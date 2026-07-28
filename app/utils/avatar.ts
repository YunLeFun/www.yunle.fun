const CLOUDBASE_FILE_ID_PREFIX = 'cloud://'
const AVATAR_FILE_PATTERN = /^\/avatars\/[^/]+\.(?:jpe?g|png|webp)$/i
const TCB_STORAGE_HOST_SUFFIX = '.tcb.qcloud.la'
const COS_STORAGE_HOST_MARKER = '.cos.'

interface CloudbaseAvatarReference {
  bucket: string
  pathname: string
}

function isAvatarPath(pathname: string): boolean {
  try {
    return AVATAR_FILE_PATTERN.test(decodeURIComponent(pathname))
  }
  catch {
    return false
  }
}

function isCurrentEnvironmentBucket(bucket: string, envId: string): boolean {
  return !!envId && bucket.includes(envId)
}

function parseCloudbaseAvatarFileID(
  source: string,
  envId: string,
): CloudbaseAvatarReference | null {
  if (!source.startsWith(CLOUDBASE_FILE_ID_PREFIX) || !envId)
    return null

  try {
    const url = new URL(source)
    const environmentPrefix = `${envId}.`
    if (
      url.protocol !== 'cloud:'
      || !url.hostname.startsWith(environmentPrefix)
      || !isAvatarPath(url.pathname)
    ) {
      return null
    }

    const bucket = url.hostname.slice(environmentPrefix.length)
    if (!isCurrentEnvironmentBucket(bucket, envId))
      return null

    return { bucket, pathname: url.pathname }
  }
  catch {
    return null
  }
}

function getPublicStorageOrigin(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:'
      || url.pathname !== '/'
      || url.search
      || url.hash
      || !url.hostname.endsWith(TCB_STORAGE_HOST_SUFFIX)
    ) {
      return null
    }
    return url
  }
  catch {
    return null
  }
}

function resolvePublicFileUrl(
  reference: CloudbaseAvatarReference,
  publicStorageOrigin: string,
): string | null {
  const origin = getPublicStorageOrigin(publicStorageOrigin)
  if (
    !origin
    || origin.hostname !== `${reference.bucket}${TCB_STORAGE_HOST_SUFFIX}`
  ) {
    return null
  }
  return new URL(reference.pathname, origin).toString()
}

/**
 * Convert one of our legacy signed CloudBase avatar URLs back to its durable
 * file ID. Third-party/OAuth avatar URLs are intentionally left untouched.
 */
export function toCloudbaseAvatarFileID(value: string | null | undefined, envId: string): string | null {
  const source = value?.trim()
  if (!source)
    return null
  if (source.startsWith(CLOUDBASE_FILE_ID_PREFIX))
    return parseCloudbaseAvatarFileID(source, envId) ? source : null
  if (!envId)
    return null

  try {
    const url = new URL(source)
    if (!isAvatarPath(url.pathname))
      return null

    const bucket = url.hostname.endsWith(TCB_STORAGE_HOST_SUFFIX)
      ? url.hostname.slice(0, -TCB_STORAGE_HOST_SUFFIX.length)
      : url.hostname.includes(COS_STORAGE_HOST_MARKER)
        ? url.hostname.slice(0, url.hostname.indexOf(COS_STORAGE_HOST_MARKER))
        : ''

    if (!isCurrentEnvironmentBucket(bucket, envId))
      return null

    const pathname = decodeURIComponent(url.pathname)
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

/**
 * Resolve a trusted public avatar reference synchronously for SSR and clients.
 * CloudBase file IDs remain the durable value stored in Auth/profile records.
 */
export function toPublicAvatarUrl(
  value: string | null | undefined,
  envId: string,
  publicStorageOrigin: string,
): string | null {
  const source = value?.trim()
  if (!source)
    return null

  const fileReference = parseCloudbaseAvatarFileID(source, envId)
  if (fileReference)
    return resolvePublicFileUrl(fileReference, publicStorageOrigin)
  if (source.startsWith(CLOUDBASE_FILE_ID_PREFIX))
    return null

  try {
    const fileID = toCloudbaseAvatarFileID(source, envId)
    if (!fileID)
      return source

    const legacyReference = parseCloudbaseAvatarFileID(fileID, envId)
    return legacyReference
      ? resolvePublicFileUrl(legacyReference, publicStorageOrigin)
      : null
  }
  catch {
    return source
  }
}
