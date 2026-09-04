import { describe, expect, it } from 'vitest'

import { WEB_RESUME_COLLECTION_MANIFEST } from '../../cloudfunctions/user-storage-api/web-resume-resources.js'

describe('web Resume CloudBase resources', () => {
  it('keeps metadata server-only and indexes every runtime query', () => {
    expect(WEB_RESUME_COLLECTION_MANIFEST).toMatchObject({
      acl: 'ADMINONLY',
      collection: 'web_resume_documents',
    })
    expect(WEB_RESUME_COLLECTION_MANIFEST.indexes.map(index => index.name)).toEqual([
      'user_state_updated',
      'user_pending_reservation',
      'user_current_reservation',
      'trash_due',
      'purge_lease_due',
    ])
    expect(WEB_RESUME_COLLECTION_MANIFEST.indexes.every(index => index.unique === false)).toBe(true)
  })
})
