import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const workflow = name => readFileSync(resolve(root, '.github/workflows', name), 'utf8')

describe('public repository workflows', () => {
  it('runs a full read-only verification pipeline for pushes and pull requests', () => {
    const source = workflow('ci.yml')

    expect(source).toMatch(/^permissions:\n {2}contents: read$/m)
    expect(source).toContain('pull_request:')
    expect(source).toContain('pnpm install --frozen-lockfile')
    expect(source).toContain('pnpm run lint')
    expect(source).toContain('pnpm run typecheck')
    expect(source).toContain('pnpm run test')
    expect(source).toContain('pnpm run build')
  })

  it('creates releases without executing an unpinned npm package', () => {
    const source = workflow('release.yml')

    expect(source).toMatch(/^permissions:\n {2}contents: write$/m)
    expect(source).toContain('gh release create "$GH_REF_NAME" --verify-tag --generate-notes')
    expect(source).toContain('GH_TOKEN: $' + '{{ github.token }}')
    expect(source).not.toContain('npx ')
  })
})
