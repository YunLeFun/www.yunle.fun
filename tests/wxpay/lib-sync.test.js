/**
 * 守护：wxpay-order/lib 与 wxpay-notify/lib 必须字节一致。
 *
 * 测试通过 = 两份代码同步；测试失败 = 请运行 `pnpm sync:wxpay-lib`。
 */

import { Buffer } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(__filename, '../../../')
const SOURCE = resolve(ROOT, 'functions/wxpay-order/lib')
const MIRROR = resolve(ROOT, 'functions/wxpay-notify/lib')

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      files.push(...(await listFiles(full)).map(f => join(entry.name, f)))
    else if (entry.isFile())
      files.push(entry.name)
  }
  return files.sort()
}

describe('wxpay lib 同步守护', () => {
  it('两端文件列表完全相同', async () => {
    const a = await listFiles(SOURCE)
    const b = await listFiles(MIRROR)
    expect(b).toEqual(a)
  })

  it('每个文件内容字节一致', async () => {
    const files = await listFiles(SOURCE)
    for (const file of files) {
      const a = await readFile(join(SOURCE, file))
      const b = await readFile(join(MIRROR, file))
      expect(
        Buffer.compare(a, b),
        `${file} drifted — 请运行 pnpm sync:wxpay-lib`,
      ).toBe(0)
    }
  })
})
