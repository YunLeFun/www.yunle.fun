import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  assertAvatarPayload,
  AVATAR_MAX_BYTES,
  uploadAvatar,
} from '../../cloudfunctions/account-api/avatars.js'

const JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from('avatar').toString('base64')}`

describe('account avatar upload', () => {
  it('uploads a validated avatar through server-side storage', async () => {
    const uploaded = []
    const cloudbaseApp = {
      async uploadFile(input) {
        uploaded.push(input)
        return { fileID: `cloud://env.bucket/${input.cloudPath}` }
      },
      async getTempFileURL({ fileList }) {
        return { fileList: [{ fileID: fileList[0], tempFileURL: 'https://example.com/avatar.jpg' }] }
      },
    }

    const res = await uploadAvatar(cloudbaseApp, {
      userId: 'u1',
      avatar: { contentType: 'image/jpeg', data: JPEG_DATA_URL },
      now: 123,
    })

    expect(res).toEqual({
      cloudPath: 'avatars/u1_123.jpg',
      fileID: 'cloud://env.bucket/avatars/u1_123.jpg',
      url: 'https://example.com/avatar.jpg',
    })
    expect(uploaded[0].fileContent).toBeInstanceOf(Buffer)
    expect(uploaded[0].fileContent.toString()).toBe('avatar')
  })

  it('rejects unsupported content types', () => {
    expect(() => assertAvatarPayload({ contentType: 'image/gif', data: JPEG_DATA_URL })).toThrow(/格式/)
  })

  it('rejects oversized avatars', () => {
    const data = Buffer.alloc(AVATAR_MAX_BYTES + 1).toString('base64')
    expect(() => assertAvatarPayload({ contentType: 'image/jpeg', data })).toThrow(/2 MiB/)
  })

  it('requires a temp file url from CloudBase', async () => {
    const cloudbaseApp = {
      async uploadFile() {
        return { fileID: 'cloud://env.bucket/avatars/u1_1.jpg' }
      },
      async getTempFileURL() {
        return { fileList: [] }
      },
    }

    await expect(uploadAvatar(cloudbaseApp, {
      userId: 'u1',
      avatar: { contentType: 'image/jpeg', data: JPEG_DATA_URL },
      now: 1,
    })).rejects.toThrow(/头像地址/)
  })
})
