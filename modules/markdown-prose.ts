import { addTemplate, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: 'markdown-prose' },
  setup(_, nuxt) {
    const proseComponents = new Map<string, string>()

    nuxt.hook('components:extend', (components) => {
      proseComponents.clear()
      for (const component of components) {
        if (!component.global || !component.pascalName.startsWith('Prose'))
          continue

        const name = component.pascalName
        proseComponents.set(name, component.global === 'sync' ? name : `Lazy${name}`)
        component.global = false
      }
    })

    addTemplate({
      filename: 'markdown-prose.ts',
      write: true,
      getContents() {
        const imports = [...proseComponents.values()].join(', ')
        const registrations = [...proseComponents].flatMap(([name, component]) => [
          `  ${name}: ${component},`,
          `  Lazy${name}: ${component},`,
        ])
        return [
          `import { ${imports} } from '#components'`,
          'export const markdownProseComponents = {',
          ...registrations,
          '}',
        ].join('\n')
      },
    })
  },
})
