// 站酷小薇展示字体（--ylf-font-dreamy）的字符清单：
// 扫描所有用展示字体渲染的文案，供子集生成脚本与覆盖率测试共用。
//
// 规则：
// - 展示字体只能通过模板里静态 class 的 `.ylf-display` / `.ylf-dreamy-display`，
//   或 DISPLAY_COMPONENTS 列出的组件使用；其他写法（:class 绑定、TS 字符串、
//   新的 var(--ylf-font-dreamy)）一律报错，避免字符逃出清单。
// - 元素内的静态文本、插值里的字符串字面量（含三元两支、`??` 兜底）自动收集；
//   同文件 <script setup> 顶层 const / computed 能静态求值的也会自动收集。
// - 无法静态求值的插值（props、v-for 变量、接口数据）必须在 DYNAMIC_TEXT 声明
//   它可能渲染的字符，否则报错。
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'
import { parse as parseSfc } from 'vue/compiler-sfc'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const FONT_PATH = 'public/fonts/zcool-xiaowei-display.woff2'

const DISPLAY_CLASSES = ['ylf-display', 'ylf-dreamy-display']
const DISPLAY_CLASS_PATTERN = /(?<![\w-])ylf-(?:dreamy-)?display(?![\w-])/g
const DISPLAY_FONT_VAR = 'var(--ylf-font-dreamy)'
/** main.css 里只允许两个工具类引用展示字体变量。 */
const CSS_FILE = 'app/assets/css/main.css'
const CSS_VAR_ALLOWED = 2

/** 内部把 prop / 具名插槽渲染成展示字体的组件：在调用处收集文案。 */
const DISPLAY_COMPONENTS = {
  AppPageHero: { prop: 'title', slot: 'title' },
}

/**
 * 子集里固定保留的字符，不依赖扫描结果：
 * 可打印 ASCII（价格、天数、拉丁字母）、人民币符号与常用标点。
 */
export const EXTRA_CHARACTERS = [
  String.fromCharCode(...Array.from({ length: 0x7E - 0x20 + 1 }, (_, i) => 0x20 + i)),
  '¥，—',
].join('')

/**
 * 无法静态求值的插值。key 为 `文件::表达式`，值为它可能渲染的文本（或返回文本的函数）。
 * 改动这些数据源时，记得同步这里并重跑 `node scripts/subset-display-font.mjs`。
 */
const DYNAMIC_TEXT = {
  // 首页标题逐字弹入，字来自同文件的 headlineText。
  'app/pages/index.vue::char.text': ({ resolve }) => resolve('headlineText'),
  // 会员卡剩余天数：数字（兜底的「—」由字面量自动收集）。
  'app/components/MemberPass.vue::daysLeft': '0123456789',
  // 会员页价格来自 content/2.pricing.yml 的 plans[].price。
  'app/pages/pricing.vue::plan.price': () => readPricingPrices(),
}

function readPricingPrices() {
  const yml = readFileSync(join(ROOT, 'content/2.pricing.yml'), 'utf8')
  const prices = []
  let priceIndent = -1
  for (const line of yml.split('\n')) {
    const indent = line.length - line.trimStart().length
    const content = line.trim()
    if (content === 'price:') {
      priceIndent = indent
      continue
    }
    if (priceIndent < 0 || !content)
      continue
    if (indent <= priceIndent) {
      priceIndent = -1
      continue
    }
    const value = content.slice(content.indexOf(':') + 1).trim()
    prices.push(value.replace(/^(['"])(.*)\1$/, '$2'))
  }
  if (!prices.length)
    throw new Error('content/2.pricing.yml: 找不到 plans[].price')
  return prices.join('')
}

function walkFiles(dir, extensions) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      files.push(...walkFiles(path, extensions))
    else if (extensions.some(ext => entry.name.endsWith(ext)))
      files.push(path)
  }
  return files
}

// ---------- 脚本求值 ----------

function parseScript(source, filename) {
  const { program, errors } = parseSync(filename, source, { lang: 'ts' })
  if (errors.length)
    throw new Error(`${filename}: ${errors[0].message}`)
  return program
}

/** 收集 <script setup> 顶层 const 的初始化表达式。 */
function collectConsts(program) {
  const consts = new Map()
  for (const statement of program.body) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const')
      continue
    for (const declarator of statement.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.init)
        consts.set(declarator.id.name, declarator.init)
    }
  }
  return consts
}

function unwrap(node) {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ChainExpression'].includes(node.type))
    node = node.expression
  return node
}

/**
 * 求值一个表达式可能渲染的文本。
 * @returns {{ texts: string[], dynamic: string[] }} dynamic 为无法求值部分的源码
 */
function evaluate(node, ctx, seen = new Set()) {
  node = unwrap(node)
  const result = { texts: [], dynamic: [] }
  const merge = (child) => {
    const value = evaluate(child, ctx, seen)
    result.texts.push(...value.texts)
    result.dynamic.push(...value.dynamic)
  }
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string' || typeof node.value === 'number')
        result.texts.push(String(node.value))
      break
    case 'TemplateLiteral':
      result.texts.push(...node.quasis.map(quasi => quasi.value.cooked))
      node.expressions.forEach(merge)
      break
    case 'ConditionalExpression':
      merge(node.consequent)
      merge(node.alternate)
      break
    case 'LogicalExpression':
      if (node.operator !== '&&')
        merge(node.left)
      merge(node.right)
      break
    case 'BinaryExpression':
      if (node.operator !== '+') {
        result.dynamic.push(ctx.slice(node))
        break
      }
      merge(node.left)
      merge(node.right)
      break
    case 'Identifier': {
      const init = ctx.consts.get(node.name)
      if (node.name === 'undefined')
        break
      if (!init || seen.has(node.name)) {
        result.dynamic.push(node.name)
        break
      }
      const value = evaluateInit(init, ctx, new Set([...seen, node.name]))
      if (value.dynamic.length)
        result.dynamic.push(node.name)
      else
        result.texts.push(...value.texts)
      break
    }
    default:
      result.dynamic.push(ctx.slice(node))
  }
  return result
}

/** const 初始化：支持 computed(() => expr | { return ... })。 */
function evaluateInit(init, ctx, seen) {
  init = unwrap(init)
  const fn = init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'computed'
    ? unwrap(init.arguments[0])
    : null
  if (!fn)
    return evaluate(init, ctx, seen)
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')
    return { texts: [], dynamic: [ctx.slice(init)] }
  if (fn.body.type !== 'BlockStatement')
    return evaluate(fn.body, ctx, seen)
  const result = { texts: [], dynamic: [] }
  const visit = (statement) => {
    if (!statement || typeof statement !== 'object')
      return
    if (statement.type === 'ReturnStatement') {
      if (statement.argument) {
        const value = evaluate(statement.argument, ctx, seen)
        result.texts.push(...value.texts)
        result.dynamic.push(...value.dynamic)
      }
      return
    }
    if (statement.type.includes('Function'))
      return
    for (const value of Object.values(statement)) {
      if (Array.isArray(value))
        value.forEach(visit)
      else if (value && typeof value.type === 'string')
        visit(value)
    }
  }
  fn.body.body.forEach(visit)
  return result
}

function createContext(file, scriptSource) {
  const program = scriptSource ? parseScript(scriptSource, `${file}.ts`) : { body: [] }
  return {
    consts: collectConsts(program),
    slice: node => scriptSource.slice(node.start, node.end),
  }
}

/** 求值模板里的一段表达式源码（插值或 v-bind）。 */
function evaluateTemplateExpression(source, ctx) {
  const wrapped = `(${source}\n)`
  const program = parseScript(wrapped, 'template-expression.ts')
  const expression = program.body[0]?.expression
  return evaluate(expression, { ...ctx, slice: node => wrapped.slice(node.start, node.end).trim() })
}

// ---------- 模板遍历 ----------

const NODE_ELEMENT = 1
const NODE_TEXT = 2
const NODE_INTERPOLATION = 5
const NODE_ATTRIBUTE = 6
const NODE_DIRECTIVE = 7

function staticClass(element) {
  const attr = element.props.find(prop => prop.type === NODE_ATTRIBUTE && prop.name === 'class')
  return attr?.value?.content ?? ''
}

function slotName(element) {
  if (element.tag !== 'template')
    return null
  const directive = element.props.find(prop => prop.type === NODE_DIRECTIVE && prop.name === 'slot')
  return directive ? (directive.arg?.content ?? 'default') : null
}

/** 收集节点子树渲染的文本；插值交给 onExpression。 */
function collectSubtree(nodes, onText, onExpression) {
  for (const node of nodes) {
    if (node.type === NODE_TEXT)
      onText(node.content)
    else if (node.type === NODE_INTERPOLATION)
      onExpression(node.content.content.trim())
    else if (node.type === NODE_ELEMENT)
      collectSubtree(node.children, onText, onExpression)
  }
}

function scanVueFile(file, source, report) {
  const { descriptor, errors } = parseSfc(source, { filename: file })
  if (errors.length)
    throw new Error(`${file}: ${errors[0].message}`)
  const ast = descriptor.template?.ast
  if (!ast)
    return
  const script = descriptor.scriptSetup ?? descriptor.script
  const ctx = createContext(file, script?.content ?? '')
  const componentName = file.match(/([^/]+)\.vue$/)[1]
  const ownDisplayProp = DISPLAY_COMPONENTS[componentName]?.prop
  let staticMatches = 0

  const addExpression = (expression, location) => {
    const { texts, dynamic } = evaluateTemplateExpression(expression, ctx)
    report.text(file, texts.join(''))
    for (const snippet of dynamic) {
      // 展示组件自己渲染的 prop：在调用处收集。
      if (snippet === ownDisplayProp)
        continue
      report.dynamic(file, snippet, location, ctx)
    }
  }

  const visit = (node) => {
    if (node.type !== NODE_ELEMENT)
      return
    for (const prop of node.props) {
      if (prop.type === NODE_DIRECTIVE && prop.exp && DISPLAY_CLASS_PATTERN.test(prop.exp.content))
        report.error(`${file}:${prop.loc.start.line} 通过绑定使用展示字体类，脚本无法收集文案；请改用静态 class`)
      DISPLAY_CLASS_PATTERN.lastIndex = 0
    }

    const classes = staticClass(node).split(/\s+/)
    const display = classes.filter(name => DISPLAY_CLASSES.includes(name))
    if (display.length) {
      staticMatches += display.length
      collectSubtree(node.children, text => report.text(file, text), expression => addExpression(expression, node.loc.start.line))
      return
    }

    const component = DISPLAY_COMPONENTS[node.tag]
    if (component) {
      const slot = node.children.find(child => child.type === NODE_ELEMENT && slotName(child) === component.slot)
      if (slot) {
        // 插槽覆盖了 prop 的默认渲染，prop 不会出现在展示字体里。
        collectSubtree(slot.children, text => report.text(file, text), expression => addExpression(expression, slot.loc.start.line))
      }
      else {
        for (const prop of node.props) {
          if (prop.type === NODE_ATTRIBUTE && prop.name === component.prop)
            report.text(file, prop.value?.content ?? '')
          else if (prop.type === NODE_DIRECTIVE && prop.name === 'bind' && prop.arg?.content === component.prop)
            addExpression(prop.exp.content, prop.loc.start.line)
        }
      }
    }
    node.children.forEach(visit)
  }
  ast.children.forEach(visit)

  const template = descriptor.template.content.replace(/<!--[\s\S]*?-->/g, '')
  const rawMatches = template.match(DISPLAY_CLASS_PATTERN)?.length ?? 0
  if (rawMatches !== staticMatches)
    report.error(`${file}: 模板里有 ${rawMatches} 处展示字体类，只识别到 ${staticMatches} 处静态 class；请用静态 class 写在元素上`)
  for (const block of [descriptor.script, descriptor.scriptSetup, ...descriptor.styles]) {
    if (block && (DISPLAY_CLASS_PATTERN.test(block.content) || block.content.includes(DISPLAY_FONT_VAR)))
      report.error(`${file}:${block.loc.start.line} 在 <script>/<style> 里使用了展示字体，脚本无法收集文案`)
    DISPLAY_CLASS_PATTERN.lastIndex = 0
  }
}

function createReport(dynamicText) {
  const sources = new Map()
  const errors = []
  const usedDynamic = new Set()
  const report = {
    text(file, text) {
      sources.set(file, (sources.get(file) ?? '') + text)
    },
    dynamic(file, snippet, line, ctx) {
      const key = `${file}::${snippet}`
      const declared = dynamicText[key]
      if (declared === undefined) {
        errors.push(`${file}:${line} 插值 \`${snippet}\` 无法静态求值；请在 scripts/lib/display-font-text.mjs 的 DYNAMIC_TEXT 声明 '${key}' 可能渲染的字符`)
        return
      }
      usedDynamic.add(key)
      const resolve = (name) => {
        const value = evaluate({ type: 'Identifier', name }, ctx)
        if (value.dynamic.length)
          throw new Error(`${file}: ${name} 无法静态求值`)
        return value.texts.join('')
      }
      report.text(file, typeof declared === 'function' ? declared({ resolve }) : declared)
    },
    error(message) {
      errors.push(message)
    },
  }
  return { report, sources, errors, usedDynamic }
}

/**
 * 只扫描一个 SFC（测试用）。
 * @returns {{ text: string, errors: string[] }}
 */
export function collectVueDisplayText(file, source, dynamicText = {}) {
  const { report, sources, errors } = createReport(dynamicText)
  scanVueFile(file, source, report)
  return { text: sources.get(file) ?? '', errors }
}

/**
 * 扫描源码，返回展示字体需要覆盖的文本。
 * @returns {{ text: string, sources: Map<string, string>, errors: string[] }}
 */
export function collectDisplayText() {
  const { report, sources, errors, usedDynamic } = createReport(DYNAMIC_TEXT)

  for (const path of walkFiles(join(ROOT, 'app'), ['.vue', '.ts', '.css', '.scss'])) {
    const file = relative(ROOT, path).split('\\').join('/')
    const source = readFileSync(path, 'utf8')
    if (file.endsWith('.vue')) {
      scanVueFile(file, source, report)
      continue
    }
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    if (file === CSS_FILE) {
      const count = code.split(DISPLAY_FONT_VAR).length - 1
      if (count !== CSS_VAR_ALLOWED)
        errors.push(`${file}: ${DISPLAY_FONT_VAR} 只应出现在 .ylf-display / .ylf-dreamy-display 两个工具类里（现有 ${count} 处）`)
      continue
    }
    if (code.includes(DISPLAY_FONT_VAR) || DISPLAY_CLASS_PATTERN.test(code))
      errors.push(`${file}: 在模板以外使用了展示字体，脚本无法收集文案`)
    DISPLAY_CLASS_PATTERN.lastIndex = 0
  }

  for (const key of Object.keys(DYNAMIC_TEXT)) {
    if (!usedDynamic.has(key))
      errors.push(`DYNAMIC_TEXT['${key}'] 已经没有对应的插值，请删除`)
  }

  const text = [...sources.values()].join('')
  return { text, sources, errors }
}

/** 去重排序、去掉空白后的字符串。 */
export function uniqueCharacters(text) {
  return [...new Set([...text].filter(char => !/\s/.test(char)))]
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0))
    .join('')
}

/** 子集需要覆盖的完整字符集：扫描结果 + EXTRA_CHARACTERS。 */
export function displayFontCharacters() {
  const { text, sources, errors } = collectDisplayText()
  return { characters: uniqueCharacters(text + EXTRA_CHARACTERS), scanned: uniqueCharacters(text), sources, errors }
}
