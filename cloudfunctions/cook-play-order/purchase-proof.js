'use strict'

const { createHash } = require('node:crypto')

const PACKAGE = 'fun.yunle.cook'

class PlayOrderError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function assertValidToken(token) {
  if (typeof token !== 'string' || !/^[\x21-\x7E]{16,2048}$/.test(token))
    throw new PlayOrderError('invalid_purchase_token')
}

function purchaseReference(token) {
  return createHash('sha256').update(token).digest('hex')
}

module.exports = { PACKAGE, PlayOrderError, assertValidToken, purchaseReference }
