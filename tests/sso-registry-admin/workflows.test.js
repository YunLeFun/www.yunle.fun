import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const workflow = name => readFileSync(resolve(root, '.github/workflows', name), 'utf8')

describe('registry protected workflows', () => {
  it('accepts only a release intent id and merges a generated-only PR after its checks pass', () => {
    const source = workflow('registry-release.yml')
    const mainGuard = source.slice(
      source.indexOf('- name: Confirm protected main has not moved'),
      source.indexOf('- name: Verify generated-only diff'),
    )

    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('releaseIntentId:')
    expect(source).toContain('actions/create-github-app-token@v2')
    expect(source).toMatch(/CLOUDBASE_API_KEY: \$\{\{ secrets\.CLOUDBASE_API_KEY \}\}/)
    expect(source).toMatch(/CLOUDBASE_ENV_ID: \$\{\{ vars\.CLOUDBASE_ENV_ID \}\}/)
    expect(source).toContain('tcb login --cloudbase-api-key "$CLOUDBASE_API_KEY" -e "$CLOUDBASE_ENV_ID"')
    expect(source.indexOf('tcb login --cloudbase-api-key')).toBeLessThan(source.indexOf('record-ci'))
    expect(source).toContain('release-export')
    expect(source).toContain('git diff --name-only')
    expect(source).toContain('chore(sso-registry): publish')
    expect(source).toContain('gh pr checks')
    expect(source).toContain('--watch --fail-fast')
    expect(source).toContain('gh pr merge')
    expect(source).toContain('--match-head-commit')
    expect(source).toContain('vars.SSO_REGISTRY_PRODUCTION_DEPLOY_ENABLED')
    expect(source).toContain('test "$PRODUCTION_DEPLOY_ENABLED" = true')
    expect(mainGuard).toContain('GH_TOKEN: $' + '{{ github.token }}')
    expect(mainGuard).toContain('gh api "repos/$' + '{GITHUB_REPOSITORY}/git/ref/heads/main" --jq .object.sha')
    expect(mainGuard).not.toContain('git fetch origin main')
    expect(source).not.toContain('gh pr merge --auto')
    expect(source).not.toMatch(/^\s{6}(environment|snapshotId|baseCommitSha):/m)
  })

  it('verifies release files before entering environment-scoped deployment jobs', () => {
    const source = workflow('registry-deploy.yml')

    expect(source).toContain('verify-release')
    expect(source).toContain('environment: development')
    expect(source).toContain('environment: production')
    expect(source).toMatch(/CLOUDBASE_API_KEY: \$\{\{ secrets\.CLOUDBASE_API_KEY \}\}/)
    expect(source).toMatch(/CLOUDBASE_ENV_ID: \$\{\{ vars\.CLOUDBASE_ENV_ID \}\}/)
    expect(source.match(/tcb login --cloudbase-api-key/g)).toHaveLength(2)
    expect(source.match(/-e "\$CLOUDBASE_ENV_ID"/g)).toHaveLength(2)
    expect(source).toContain('group: sso-registry-production')
    expect(source).toContain('record-deployment')
    expect(source).toContain('vars.SSO_REGISTRY_PRODUCTION_DEPLOY_ENABLED == \'true\'')
    expect(source.indexOf('verify-release')).toBeLessThan(source.indexOf('environment: production'))
  })
})
