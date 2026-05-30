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
 *   db.collection(name).doc(id).update(updates)
 *
 * 支持 where 等值匹配的简单条件（无 operator）。
 */
export function makeFakeDb(initial = {}) {
  const store = {}
  for (const [k, v] of Object.entries(initial))
    store[k] = v.map(doc => ({ ...doc }))

  function nextId(name) {
    return `${name}_${Object.keys(store[name] || {}).length}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  }

  function matches(doc, where) {
    return Object.entries(where).every(([k, v]) => doc[k] === v)
  }

  function collection(name) {
    if (!store[name])
      store[name] = []
    let whereClause = null
    let limitClause = Infinity

    const chain = {
      where(query) {
        whereClause = query
        return chain
      },
      limit(n) {
        limitClause = n
        return chain
      },
      async get() {
        let data = store[name]
        if (whereClause)
          data = data.filter(d => matches(d, whereClause))
        if (Number.isFinite(limitClause))
          data = data.slice(0, limitClause)
        return { data: data.map(d => ({ ...d })) }
      },
      async add(doc) {
        const _id = doc._id ?? nextId(name)
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
      doc(id) {
        return {
          async get() {
            const doc = store[name].find(d => d._id === id)
            return { data: doc ? { ...doc } : null }
          },
          async update(updates) {
            const doc = store[name].find(d => d._id === id)
            if (!doc)
              return { updated: 0 }
            Object.assign(doc, updates)
            return { updated: 1 }
          },
        }
      },
    }
    return chain
  }

  return {
    _store: store,
    collection,
  }
}
