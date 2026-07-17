import type { AppExplorerMeta, ExplorerCategory } from '~/types/app-explorer'

export const explorerCategories: ExplorerCategory[] = [
  {
    id: 'inspiration',
    label: '灵感智能',
    description: '让灵感落地的智能应用',
    icon: 'i-lucide-sparkles',
    anchor: { x: 22, y: 25 },
  },
  {
    id: 'creative',
    label: '创意实验',
    description: '视觉、交互与有趣实验',
    icon: 'i-lucide-wand-sparkles',
    anchor: { x: 54, y: 19 },
  },
  {
    id: 'developer',
    label: '开发工具',
    description: '面向开发者的组件与工具',
    icon: 'i-lucide-code-xml',
    anchor: { x: 80, y: 31 },
  },
  {
    id: 'play',
    label: '轻松一下',
    description: '游戏、生成器与互动玩具',
    icon: 'i-lucide-gamepad-2',
    anchor: { x: 32, y: 66 },
  },
  {
    id: 'life',
    label: '生活日常',
    description: '给日常添一点轻松和便利',
    icon: 'i-lucide-coffee',
    anchor: { x: 64, y: 71 },
  },
  {
    id: 'community',
    label: '社区共建',
    description: '连接创作者与开源社区',
    icon: 'i-lucide-users-round',
    anchor: { x: 87, y: 68 },
  },
  {
    id: 'other',
    label: '其他云朵',
    description: '等待被发现的新鲜应用',
    icon: 'i-lucide-cloud',
    anchor: { x: 50, y: 48 },
  },
]

export const appExplorerMeta: Record<string, AppExplorerMeta> = {
  'ai-sfc': { category: 'inspiration', tags: ['AI', 'Vue', '生成器'], featured: true },
  'pixi-painter': { category: 'inspiration', tags: ['绘画', 'PixiJS'], featured: true },
  'explosions': { category: 'creative', tags: ['动画', '实验'] },
  'normal-puppy': { category: 'creative', tags: ['互动', '创意'], featured: true },
  'char-dust': { category: 'creative', tags: ['文字', '特效'] },
  'color-dust': { category: 'creative', tags: ['色彩', '特效'] },
  'wc-github-corners': { category: 'developer', tags: ['Web Component', 'GitHub'] },
  'star-markdown-css': { category: 'developer', tags: ['Markdown', 'CSS'] },
  'web-resume': { category: 'developer', tags: ['简历', 'Web'] },
  'el-bot': { category: 'developer', tags: ['Element Plus', '组件'] },
  'valaxy': { category: 'developer', tags: ['博客', 'SSG'], featured: true },
  'augma': { category: 'developer', tags: ['Vue', '组件库'] },
  'ak-ui': { category: 'developer', tags: ['UI', '组件库'] },
  'fc': { category: 'play', tags: ['游戏', '红白机'], featured: true },
  'chat-generator': { category: 'play', tags: ['生成器', '聊天'] },
  'birthday': { category: 'play', tags: ['生日', '祝福'] },
  'go-far-away': { category: 'play', tags: ['互动', '小游戏'] },
  'cook': { category: 'life', tags: ['做饭', '生活'] },
  'electric-fan': { category: 'life', tags: ['风扇', '解暑'] },
  'air-conditioner': { category: 'life', tags: ['空调', '解暑'] },
  'give-me-money': { category: 'life', tags: ['趣味', '生活'] },
  'sponsors': { category: 'community', tags: ['赞助', '社区'] },
}

export const explorerAccentPalette = [
  'var(--ylf-dopa-cyan)',
  'var(--ylf-dopa-blue)',
  'var(--ylf-dopa-violet)',
  'var(--ylf-dopa-pink)',
  'var(--ylf-dopa-amber)',
  'var(--ylf-dopa-green)',
]
