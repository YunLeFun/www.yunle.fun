#!/usr/bin/env node
// 重新生成站酷小薇展示字体子集 public/fonts/zcool-xiaowei-display.woff2。
//
// 用法：
//   node scripts/subset-display-font.mjs --check
//     只检查：列出展示字体文案里、当前子集缺字形的字符（不需要源字体）。
//   node scripts/subset-display-font.mjs --source path/to/ZCOOLXiaoWei-Regular.ttf
//     用 OFL 源字体重新生成子集。源字体不入库，可从
//     https://github.com/google/fonts/tree/main/ofl/zcoolxiaowei 获取。
//     也可通过环境变量 ZCOOL_XIAOWEI_SOURCE 指定。
//   --print  打印将写入子集的字符后退出。
//
// 子集由 fontTools 的 pyftsubset 生成：优先用 PATH 上的 pyftsubset，
// 否则通过 `uvx --from fonttools[woff] pyftsubset` 临时运行。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { displayFontCharacters, FONT_PATH, ROOT } from './lib/display-font-text.mjs'
import { readWoff2CodePoints } from './lib/woff2-cmap.mjs'

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    print: { type: 'boolean', default: false },
    source: { type: 'string', default: process.env.ZCOOL_XIAOWEI_SOURCE },
  },
})

const fontFile = join(ROOT, FONT_PATH)
const { characters, sources, errors } = displayFontCharacters()

if (errors.length) {
  console.error('展示字体文案无法完整收集：')
  for (const error of errors)
    console.error(`  - ${error}`)
  process.exit(1)
}

if (values.print) {
  console.log(characters)
  process.exit(0)
}

function missingCharacters() {
  const covered = readWoff2CodePoints(readFileSync(fontFile))
  return [...characters].filter(char => !covered.has(char.codePointAt(0)))
}

if (values.check || !values.source) {
  const missing = missingCharacters()
  console.log(`扫描到 ${sources.size} 处展示字体文案，共需 ${characters.length} 个字符。`)
  if (!missing.length) {
    console.log(`${FONT_PATH} 已覆盖全部字符。`)
    process.exit(0)
  }
  console.error(`${FONT_PATH} 缺少 ${missing.length} 个字符：${missing.join('')}`)
  if (!values.check)
    console.error('请用 --source <ZCOOLXiaoWei-Regular.ttf> 重新生成子集。')
  process.exit(1)
}

const source = resolve(values.source)
if (!existsSync(source)) {
  console.error(`找不到源字体：${source}`)
  process.exit(1)
}

function findSubsetter() {
  const local = spawnSync('pyftsubset', ['--help'], { stdio: 'ignore' })
  if (!local.error)
    return ['pyftsubset']
  const uvx = spawnSync('uvx', ['--version'], { stdio: 'ignore' })
  if (!uvx.error)
    return ['uvx', '--from', 'fonttools[woff]', 'pyftsubset']
  console.error('需要 fontTools：pip install "fonttools[woff]"，或安装 uv 后重试。')
  process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'ylf-display-font-'))
try {
  const textFile = join(workDir, 'characters.txt')
  writeFileSync(textFile, characters)
  const [command, ...prefix] = findSubsetter()
  const result = spawnSync(command, [
    ...prefix,
    source,
    `--text-file=${textFile}`,
    `--output-file=${fontFile}`,
    '--flavor=woff2',
    // 与最初的子集一致：不带 TrueType hinting，展示字号下无差别且更小。
    '--no-hinting',
  ], { stdio: 'inherit' })
  if (result.status !== 0)
    process.exit(result.status ?? 1)
}
finally {
  rmSync(workDir, { recursive: true, force: true })
}

const missing = missingCharacters()
if (missing.length) {
  console.error(`源字体本身缺少这些字符：${missing.join('')}`)
  process.exit(1)
}
console.log(`已生成 ${FONT_PATH}：${characters.length} 个字符，${(statSync(fontFile).size / 1024).toFixed(1)} KB`)
