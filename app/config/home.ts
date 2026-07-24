export const homePage = {
  title: '云之彼端，[乐趣]{class="ylf-gradient-text ylf-gradient-text--sun"}无限',
  description: '从云乐坊正在维护的官方应用出发，发现实用、好玩，或有一点奇思妙想的云端体验。',
  headline: '云端应用集合',
  seo: {
    title: '云乐坊',
    description: '浏览云乐坊官方应用，发现实用、好玩或充满想象力的云端体验。',
  },
  hero: {
    links: [
      {
        label: '浏览应用',
        icon: 'i-lucide-arrow-right',
        trailing: true,
        to: '/explore',
        size: 'xl' as const,
      },
      {
        label: '创建账号',
        icon: 'i-lucide-user-plus',
        size: 'xl' as const,
        color: 'neutral' as const,
        variant: 'outline' as const,
        to: '/signup',
      },
    ],
  },
  journey: {
    headline: '从这里开始',
    title: '先逛应用，再决定是否创建账号',
    description: '浏览应用不需要先注册。找到感兴趣的作品后，再根据应用提示登录或创建账号。',
    items: [
      {
        title: '浏览当前应用',
        description: '在应用图谱中查看云乐坊已经公开的官方应用。',
        icon: 'i-lucide-compass',
        to: '/explore',
        linkLabel: '前往应用市场',
      },
      {
        title: '打开并体验',
        description: '先阅读应用介绍，再从详情页打开对应的在线体验。',
        icon: 'i-lucide-mouse-pointer-click',
      },
      {
        title: '需要时创建账号',
        description: '在需要保存状态或使用平台权益时，使用统一账号继续。',
        icon: 'i-lucide-user-round-check',
        to: '/signup',
        linkLabel: '创建账号',
      },
    ],
  },
  cta: {
    title: '从一朵有趣的云开始',
    description: '先看看目前有哪些应用。需要保存跨应用身份或平台权益时，再创建账号。',
    links: [
      {
        label: '浏览应用',
        to: '/explore',
        trailingIcon: 'i-lucide-arrow-right',
      },
      {
        label: '创建账号',
        to: '/signup',
        variant: 'outline' as const,
        icon: 'i-lucide-user-plus',
      },
    ],
  },
}
