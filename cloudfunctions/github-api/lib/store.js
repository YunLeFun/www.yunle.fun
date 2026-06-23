/**
 * github_installations 集合读写：CloudBase uid ↔ GitHub installation 映射。
 *
 * 文档结构（_id = uid，一个用户一条）：
 *   { _id, installationId, githubLogin, accountType, repositorySelection, createdAt, updatedAt }
 * 索引：idx_installation（installationId，非唯一，给 webhook 反查用）。
 *
 * db 由调用方注入（同 account-api 的 lib 约定），便于用 fake db 单测。
 */
'use strict'

const COLLECTION = 'github_installations'

function firstDoc(data) {
  if (Array.isArray(data))
    return data[0] || null
  return data || null
}

/** 读取某用户的安装映射；无则返回 null。 */
async function getInstallation(db, uid) {
  try {
    const { data } = await db.collection(COLLECTION).doc(uid).get()
    return firstDoc(data)
  }
  catch {
    return null
  }
}

/** upsert 映射，保留首次 createdAt。 */
async function upsertInstallation(db, uid, fields, now) {
  const existing = await getInstallation(db, uid)
  // doc(uid) 已指定主键，set 的 payload 不带 _id（避免部分 SDK 版本报错）
  const doc = {
    installationId: fields.installationId,
    githubLogin: fields.githubLogin || '',
    accountType: fields.accountType || '',
    repositorySelection: fields.repositorySelection || '',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await db.collection(COLLECTION).doc(uid).set(doc)
  return { _id: uid, ...doc }
}

/** 删除映射（本地解绑；GitHub 侧卸载需用户自行操作）。 */
async function deleteInstallation(db, uid) {
  try {
    await db.collection(COLLECTION).doc(uid).remove()
  }
  catch {
    // 不存在视为已删除
  }
  return { ok: true }
}

/** 按 installationId 反查（webhook 用，Phase 4）。 */
async function findByInstallationId(db, installationId) {
  const { data } = await db.collection(COLLECTION).where({ installationId }).limit(1).get()
  return firstDoc(data)
}

module.exports = {
  GITHUB_INSTALLATIONS_COLLECTION: COLLECTION,
  getInstallation,
  upsertInstallation,
  deleteInstallation,
  findByInstallationId,
}
