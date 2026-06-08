#!/usr/bin/env node
/**
 * 让 git 使用仓库内的 scripts/git-hooks 作为 hooks 目录（随仓库版本化、克隆即生效）。
 * 在 postinstall 中调用；非 git 环境（如纯 tarball 安装）静默跳过。
 */
import { execSync } from 'node:child_process'

try {
  execSync('git config core.hooksPath scripts/git-hooks', { stdio: 'ignore' })
}
catch {
  // 不是 git 仓库 / 没有 git，忽略即可
}
