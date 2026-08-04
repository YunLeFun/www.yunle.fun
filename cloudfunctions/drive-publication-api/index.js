'use strict'

const { createHash } = require('node:crypto')
const cloudbase = require('@cloudbase/node-sdk')
const { createPublisher } = require('./publisher')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const publish = createPublisher()

function sourceRefHash(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

async function audit(event, result) {
  const record = {
    action: 'publication.copy',
    actorId: String(event?.userId || ''),
    assetId: String(event?.assetId || ''),
    createdAt: new Date().toISOString(),
    projectId: String(event?.projectId || ''),
    publicKey: String(result?.publicKey || event?.publicKey || ''),
    sourceRefHash: sourceRefHash(event?.sourceKey),
    status: result?.status || 'failed',
    tenantId: 'yunlefun',
  }
  // Keep a durable, source-key-free SCF log even when the optional database sink is unavailable.
  // eslint-disable-next-line no-console
  console.info('[drive-publication-api] audit', record)
  await db.collection('drive_audit').add(record)
}

exports.main = async (event) => {
  try {
    const result = await publish(event)
    await audit(event, result).catch(error => console.error('[drive-publication-api] 审计数据库写入失败', {
      error: error?.message || String(error),
      publicKey: result.publicKey,
      status: result.status,
    }))
    return result
  }
  catch (error) {
    await audit(event, { status: 'failed' }).catch(() => undefined)
    console.error('[drive-publication-api] 发布失败', {
      action: event?.action,
      assetId: event?.assetId,
      error: error?.message || String(error),
      projectId: event?.projectId,
      userId: event?.userId,
    })
    throw error
  }
}

exports._private = { audit, sourceRefHash }
