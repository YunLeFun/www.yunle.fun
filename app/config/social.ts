export interface SocialItem {
  icon: string
  title: string
  to: string
}

export const socialList: SocialItem[] = [
  {
    icon: 'i-ri-mail-fill',
    title: 'i@yunle.fun',
    to: 'mailto:i@yunle.fun'
  },
  {
    icon: 'i-ri-github-fill',
    title: 'YunLeFun',
    to: 'https://github.com/YunLeFun'
  },
  {
    icon: 'i-ri-qq-fill',
    title: 'QQ频道 云乐坊',
    to: 'https://pd.qq.com/s/grfe9jxoe'
  },
  {
    icon: 'i-ri-wechat-fill',
    title: '云乐坊工作室｜微信公众号',
    to: 'https://studio.yunle.fun/images/yunlefun-wechat.webp'
  },
  {
    icon: 'i-ri-bilibili-fill',
    title: '云乐坊工作室｜哔哩哔哩',
    to: 'https://space.bilibili.com/165596026'
  },
  {
    icon: 'i-ri-weibo-fill',
    title: '云乐坊工作室',
    to: 'https://weibo.com/yunlefun'
  },
  {
    icon: 'i-ri-twitter-fill',
    title: 'YunLeFun | Twitter',
    to: 'https://twitter.com/YunLeFun'
  }
]
