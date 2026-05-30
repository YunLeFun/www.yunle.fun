#!/usr/bin/env node
/**
 * 同步微信支付纯函数库到两个云函数目录。
 *
 * 「权威源」: functions/wxpay-order/lib/
 * 「镜像」:   functions/wxpay-notify/lib/
 *
 * CloudBase 云函数部署单元相互隔离（各自打包 node_modules），无法跨函数 require，
 * 因此必须保持两份代码内容字节一致。本脚本：
 *
 *   - 默认模式：把权威源覆盖到 wxpay-notify/lib
 *   - --check：仅比对，发现差异时返回非零退出码，给 CI 用
 *
 * 使用：
 *   pnpm sync:wxpay-lib
 *   pnpm sync:wxpay-lib --check
 */

import { Buffer } from 'node:buffer'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SOURCE = resolve(ROOT, 'functions/wxpay-order/lib')
const TARGETS = [resolve(ROOT, 'functions/wxpay-notify/lib')]

const checkOnly = process.argv.includes('--check')

/** @returns {Promise<string[]>} 源目录下所有相对路径（递归） */
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)).map(f => join(entry.name, f)))
    }
    else if (entry.isFile()) {
      files.push(entry.name)
    }
  }
  return files
}

async function readSafe(path) {
  try {
    return await readFile(path)
  }
  catch (err) {
    if (err.code === 'ENOENT')
      return null
    throw err
  }
}

let diverged = 0
const fileNames = await listFiles(SOURCE)

for (const target of TARGETS) {
  // 1. 收集 target 端已有文件
  let existing = []
  try {
    existing = await listFiles(target)
  }
  catch (err) {
    if (err.code !== 'ENOENT')
      throw err
  }
  const sourceSet = new Set(fileNames)

  // 2. 删除 target 中不在 source 的"残留"文件
  for (const file of existing) {
    if (!sourceSet.has(file)) {
      const stalePath = join(target, file)
      if (checkOnly) {
        console.error(`[sync-wxpay-lib] DRIFT: 多余文件 ${relative(ROOT, stalePath)}`)
        diverged++
      }
      else {
        await rm(stalePath, { force: true })
        console.warn(`[sync-wxpay-lib] removed stale ${relative(ROOT, stalePath)}`)
      }
    }
  }

  // 3. 将 source 文件复制/比对到 target
  for (const file of fileNames) {
    const sourceFile = join(SOURCE, file)
    const targetFile = join(target, file)
    const sourceBuf = await readFile(sourceFile)
    const targetBuf = await readSafe(targetFile)
    if (targetBuf && Buffer.compare(sourceBuf, targetBuf) === 0) {
      continue
    }
    if (checkOnly) {
      console.error(`[sync-wxpay-lib] DRIFT: ${relative(ROOT, targetFile)} 与权威源不一致`)
      diverged++
    }
    else {
      await mkdir(dirname(targetFile), { recursive: true })
      await writeFile(targetFile, sourceBuf)
      console.warn(`[sync-wxpay-lib] synced ${relative(ROOT, targetFile)}`)
    }
  }
}

if (checkOnly && diverged > 0) {
  console.error(`\n[sync-wxpay-lib] 共 ${diverged} 处不一致，请运行 \`pnpm sync:wxpay-lib\` 后重试。`)
  process.exit(1)
}

if (!checkOnly)
  console.warn('[sync-wxpay-lib] OK')
