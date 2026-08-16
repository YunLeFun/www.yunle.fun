/**
 * 测试 fixture：生成临时 RSA 密钥对、加密 resource、签发回调签名等。
 *
 * 不依赖真实微信证书，所有密钥都是测试运行期间随机生成的。
 */

import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'

/** 生成临时 RSA 密钥对（PKCS#8 PEM） */
export function makeKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

/** 用临时私钥对 `${timestamp}\n${nonce}\n${body}\n` 做 RSA-SHA256 签名 */
export function signCallback({ privateKey, timestamp, nonce, body }) {
  const content = `${timestamp}\n${nonce}\n${body}\n`
  return crypto.createSign('RSA-SHA256').update(content).sign(privateKey, 'base64')
}

/**
 * 用 APIv3 Key 加密 resource 对象，返回符合微信回调格式的 resource 字段
 */
export function encryptResource({ apiV3Key, plaintext, associatedData = 'transaction' }) {
  if (apiV3Key.length !== 32)
    throw new Error('apiV3Key 必须 32 字节')
  // GCM nonce 12 字节，但微信使用 16 字节的 nonce（实测）
  // 注意：crypto.createCipheriv 对 GCM 接受任意长度 IV
  const nonce = crypto.randomBytes(12).toString('hex').slice(0, 16)
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce))
  cipher.setAAD(Buffer.from(associatedData))
  const data = JSON.stringify(plaintext)
  const enc = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const ciphertext = Buffer.concat([enc, tag]).toString('base64')
  return {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext,
    associated_data: associatedData,
    nonce,
    original_type: 'transaction',
  }
}

/**
 * 构造一个完整的回调 event（HTTP 触发器格式）
 */
export function makeCallbackEvent({
  apiV3Key,
  privateKey,
  serial,
  resourcePlaintext,
  eventType = 'TRANSACTION.SUCCESS',
  timestamp = String(Math.floor(Date.now() / 1000)),
  nonce = crypto.randomBytes(16).toString('hex'),
}) {
  const resource = encryptResource({ apiV3Key, plaintext: resourcePlaintext })
  const notification = {
    id: `EV-${Date.now()}`,
    create_time: new Date().toISOString(),
    event_type: eventType,
    resource_type: 'encrypt-resource',
    summary: '支付成功',
    resource,
  }
  const body = JSON.stringify(notification)
  const signature = signCallback({ privateKey, timestamp, nonce, body })
  return {
    httpMethod: 'POST',
    headers: {
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Signature': signature,
      'Wechatpay-Serial': serial,
      'Content-Type': 'application/json',
    },
    body,
  }
}

/**
 * 构造一个最小可工作的 fake CloudBase db
 *
 * 接口子集：
 *   db.collection(name).add(doc)
 *   db.collection(name).where(query).limit(n).get()
 *   db.collection(name).where(query).update(updates)
 *   db.collection(name).where(query).remove()
 *   db.collection(name).doc(id).get()/set(doc)
 *   db.collection(name).doc(id).update(updates)
 *   db.collection(name).doc(id).remove()
 *   db.runTransaction(callback)（串行执行，异常时回滚内存快照）
 *
 * 支持 where 等值匹配、command.in / command.gt 与 db.RegExp 条件。
 */
export function makeFakeDb(initial = {}) {
  const store = {}
  for (const [k, v] of Object.entries(initial))
    store[k] = v.map(doc => ({ ...doc }))
  let transactionTail = Promise.resolve()

  function restoreStore(snapshot) {
    for (const key of Object.keys(store))
      delete store[key]
    for (const [key, value] of Object.entries(snapshot))
      store[key] = structuredClone(value)
  }

  function nextId(name) {
    return `${name}_${Object.keys(store[name] || {}).length}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  }

  function matchValue(docVal, cond) {
    // 支持 command.in：{ __op: 'in', values: [...] }
    if (cond && typeof cond === 'object' && cond.__op === 'in')
      return Array.isArray(cond.values) && cond.values.includes(docVal)
    // 支持 command.gt：{ __op: 'gt', value }（游标分页用）
    if (cond && typeof cond === 'object' && cond.__op === 'gt')
      return docVal > cond.value
    // 支持 db.RegExp：{ __op: 'regexp', regexp, options }
    if (cond && typeof cond === 'object' && cond.__op === 'regexp')
      return typeof docVal === 'string' && new RegExp(cond.regexp, cond.options).test(docVal)
    return docVal === cond
  }

  function matches(doc, where) {
    return Object.entries(where).every(([k, v]) => matchValue(doc[k], v))
  }

  function collection(name) {
    if (!store[name])
      store[name] = []
    let whereClause = null
    // CloudBase get() defaults to 100 documents when limit() is omitted.
    // Keeping the fake aligned prevents tests from silently relying on an
    // unbounded query that production will truncate.
    let limitClause = 100
    let skipClause = 0
    let orderByClause = null

    const chain = {
      where(query) {
        whereClause = query
        return chain
      },
      limit(n) {
        limitClause = n
        return chain
      },
      skip(n) {
        skipClause = n
        return chain
      },
      orderBy(field, direction) {
        orderByClause = { field, direction }
        return chain
      },
      async get() {
        let data = store[name]
        if (whereClause)
          data = data.filter(d => matches(d, whereClause))
        if (orderByClause) {
          const { field, direction } = orderByClause
          const sign = direction === 'desc' ? -1 : 1
          data = data.slice().sort((a, b) => (a[field] === b[field] ? 0 : (a[field] > b[field] ? 1 : -1) * sign))
        }
        if (skipClause > 0)
          data = data.slice(skipClause)
        if (Number.isFinite(limitClause))
          data = data.slice(0, limitClause)
        return { data: data.map(d => ({ ...d })) }
      },
      async add(doc) {
        const _id = doc._id ?? nextId(name)
        if (store[name].some(item => item._id === _id))
          throw new Error(`duplicate key error collection: ${name} _id: ${_id}`)
        const full = { _id, ...doc }
        store[name].push(full)
        return { id: _id }
      },
      async update(updates) {
        let count = 0
        for (const doc of store[name]) {
          if (whereClause && !matches(doc, whereClause))
            continue
          Object.assign(doc, updates)
          count++
        }
        return { updated: count, modifiedCount: count }
      },
      async remove() {
        const before = store[name].length
        store[name] = store[name].filter(doc => (whereClause ? !matches(doc, whereClause) : false))
        return { deleted: before - store[name].length }
      },
      doc(id) {
        return {
          async get() {
            const doc = store[name].find(d => d._id === id)
            return { data: doc ? { ...doc } : null }
          },
          async set(doc) {
            const index = store[name].findIndex(d => d._id === id)
            const full = { ...doc, _id: id }
            if (index >= 0)
              store[name][index] = full
            else
              store[name].push(full)
            return { updated: index >= 0 ? 1 : 0, upsertedId: index >= 0 ? '' : id }
          },
          async update(updates) {
            const doc = store[name].find(d => d._id === id)
            if (!doc)
              return { updated: 0 }
            Object.assign(doc, updates)
            return { updated: 1 }
          },
          async remove() {
            const before = store[name].length
            store[name] = store[name].filter(d => d._id !== id)
            return { deleted: before - store[name].length }
          },
        }
      },
    }
    return chain
  }

  async function runTransaction(callback) {
    const previous = transactionTail
    let release
    transactionTail = new Promise((resolve) => {
      release = resolve
    })
    await previous
    const snapshot = structuredClone(store)
    try {
      return await callback({ collection })
    }
    catch (error) {
      restoreStore(snapshot)
      throw error
    }
    finally {
      release()
    }
  }

  return {
    _store: store,
    command: {
      in: values => ({ __op: 'in', values }),
      gt: value => ({ __op: 'gt', value }),
    },
    RegExp: ({ regexp, options = '' }) => ({ __op: 'regexp', regexp, options }),
    collection,
    runTransaction,
  }
}
