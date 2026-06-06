export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'slate',
    },
    pageCard: {
      slots: {
        root: 'transition duration-300 ease-out hover:-translate-y-1 hover:ring-primary/40 hover:shadow-xl hover:shadow-primary/10',
      },
    },
  },
})
