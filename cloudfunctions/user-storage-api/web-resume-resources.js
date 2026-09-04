/** Server-only CloudBase collection contract for Web Resume document metadata. */

'use strict'

const WEB_RESUME_COLLECTION_MANIFEST = Object.freeze({
  acl: 'ADMINONLY',
  collection: 'web_resume_documents',
  indexes: Object.freeze([
    {
      fields: [
        { field: 'userId', order: 'asc' },
        { field: 'state', order: 'asc' },
        { field: 'recordType', order: 'asc' },
        { field: 'updatedAt', order: 'desc' },
      ],
      name: 'user_state_updated',
      unique: false,
    },
    {
      fields: [
        { field: 'userId', order: 'asc' },
        { field: 'pendingSave.reservationId', order: 'asc' },
      ],
      name: 'user_pending_reservation',
      unique: false,
    },
    {
      fields: [
        { field: 'userId', order: 'asc' },
        { field: 'currentReservationId', order: 'asc' },
      ],
      name: 'user_current_reservation',
      unique: false,
    },
    {
      fields: [
        { field: 'recordType', order: 'asc' },
        { field: 'state', order: 'asc' },
        { field: 'purgeAfter', order: 'asc' },
      ],
      name: 'trash_due',
      unique: false,
    },
    {
      fields: [
        { field: 'recordType', order: 'asc' },
        { field: 'state', order: 'asc' },
        { field: 'purgeLeaseExpiresAt', order: 'asc' },
      ],
      name: 'purge_lease_due',
      unique: false,
    },
  ]),
})

module.exports = { WEB_RESUME_COLLECTION_MANIFEST }
