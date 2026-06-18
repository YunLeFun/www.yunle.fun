export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'slate',
    },
    pageCard: {
      // 上浮/描边/换影是「可点击卡片」的交互暗示，仅在 to / onClick 的卡片上启用。
      // 静态容器卡片（登录、点评、设置面板等）不再上浮，同时消除指针停在卡片
      // 底边时 hover 反复进出导致的上下抖动。
      variants: {
        to: {
          true: {
            root: 'transition duration-300 ease-out hover:-translate-y-1 hover:ring-primary/40 hover:shadow-xl hover:shadow-primary/10',
          },
        },
      },
    },
  },
})
