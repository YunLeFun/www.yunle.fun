export const homePage = {
  title: '探索 [有趣]{class="ylf-gradient-text"} 的云端应用（Deving...）',
  description: '发现和分享更多的云端应用，让世界更加有趣多彩。',
  headline: '🎈 云端应用创意社区',
  seo: {
    title: '云乐坊',
    description: '探索更多有趣的云端应用',
  },
  hero: {
    links: [
      {
        label: '开始探索',
        icon: 'i-lucide-arrow-right',
        trailing: true,
        to: 'https://apps.yunle.fun',
        target: '_blank',
        size: 'xl' as const,
      },
      {
        label: '下载 APP',
        icon: 'i-ri:mobile-download-line',
        size: 'xl' as const,
        color: 'neutral' as const,
        variant: 'outline' as const,
        class: 'ylf-gradient-border',
        to: '/apps/download',
      },
    ],
  },
  sections: [
    {
      title: '云端应用 APP 市场',
      description: '探索 N+ 云端应用，云同步收藏夹，分享你的作品',
      headline: '🛍️ 应用市场',
      id: 'features',
      orientation: 'horizontal' as const,
      features: [
        {
          title: '10+ APPs',
          description: '来自云乐坊的 10+ 自研应用与社区优质应用',
          icon: 'i-ri:smartphone-line',
        },
        {
          title: '用户信息',
          description: '每日推荐，链接个人账户，云同步你的快捷入口、收藏喜好',
          icon: 'i-ri:user-2-line',
        },
        {
          title: '创意工坊',
          description: '上架分享你的作品或 AI 应用，让世界看到你的创意',
          icon: 'i-lucide-code-2',
        },
      ],
    },
    {
      title: '开发者平台',
      description: '一站式部署托管或自由上架云端应用，与云乐坊一起共建你的创意社区',
      headline: '🚀 开发者平台',
      orientation: 'horizontal' as const,
      reverse: true,
      features: [
        {
          title: 'CDN 加速',
          description: '辅助托管云端应用，接入 CDN 加速',
          icon: 'i-lucide-zap',
        },
        {
          title: '第三方接入',
          description: '自由接入第三方云服务商上架你的应用',
          icon: 'i-ri:cloud-line',
        },
        {
          title: '分享你的创意',
          description: '分享你的作品或 AI 应用，让世界看到你的创意',
          icon: 'i-lucide-globe',
        },
      ],
    },
  ],
  features: {
    headline: '✨ 为什么选择云乐坊',
    title: '让你的创意有一个家',
    description: '像橱窗一样展示你的作品，让更多人看到你的创意',
    items: [
      {
        title: '独立 APP',
        description: '为用户常用的云端应用提供快捷的一级入口',
        icon: 'i-ri:smartphone-line',
      },
      {
        title: '云同步',
        description: '链接社交账户，云同步你的快捷入口、收藏喜好',
        icon: 'i-ri:cloud-line',
      },
      {
        title: '探索发现分享',
        description: '在工坊探索、发现、分享更多有趣的作品',
        icon: 'i-ri:share-line',
      },
    ],
  },
  testimonials: {
    headline: '用户怎么说',
    title: '加入云乐坊的创意社区',
    description: '探索、创建与分享你的云端应用',
    items: [
      {
        quote: '还不错！',
        user: {
          name: '沃兹基硕德',
          description: '前端开发工程师',
          avatar: {
            src: 'https://www.yunyoujun.cn/images/avatar.jpg',
          },
        },
      },
      {
        quote: 'LGTM!',
        user: {
          name: '云游君',
          description: 'GitHub 活跃开发者',
          avatar: {
            src: 'https://www.yunyoujun.cn/images/avatar.jpg',
          },
        },
      },
      {
        quote: 'El Psy Congroo.',
        user: {
          name: '小云',
          description: '不知名虚拟偶像',
          avatar: {
            src: 'https://www.yunyoujun.cn/images/avatar.jpg',
          },
        },
      },
    ],
  },
  cta: {
    title: '准备好探索或构建你的云端应用了吗？',
    description: '加入云乐坊创意社区，发现更多有趣的云端应用，或分享你自己的作品，让世界看到你的创意！',
    links: [
      {
        label: '开发者平台',
        to: '/developer/',
        target: '_blank',
        trailingIcon: 'i-lucide-arrow-right',
      },
      {
        label: '开发者社区',
        to: 'https://github.com/orgs/YunLeFun/discussions',
        target: '_blank',
        variant: 'outline' as const,
        class: 'ylf-gradient-border',
        icon: 'i-simple-icons-github',
      },
    ],
  },
}
