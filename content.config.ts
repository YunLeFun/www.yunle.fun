import { defineCollection, z } from '@nuxt/content'

const variantEnum = z.enum(['solid', 'outline', 'subtle', 'soft', 'ghost', 'link'])
const colorEnum = z.enum(['primary', 'secondary', 'neutral', 'error', 'warning', 'success', 'info'])
const sizeEnum = z.enum(['xs', 'sm', 'md', 'lg', 'xl'])
const orientationEnum = z.enum(['vertical', 'horizontal'])

function createBaseSchema() {
  return z.object({
    title: z.string().nonempty(),
    description: z.string().nonempty(),
  })
}

function createFeatureItemSchema() {
  return createBaseSchema().extend({
    icon: z.string().nonempty().editor({ input: 'icon' }),
  })
}

function createLinkSchema() {
  return z.object({
    label: z.string().nonempty(),
    to: z.string().nonempty(),
    icon: z.string().optional().editor({ input: 'icon' }),
    trailingIcon: z.string().optional().editor({ input: 'icon' }),
    size: sizeEnum.optional(),
    trailing: z.boolean().optional(),
    target: z.string().optional(),
    color: colorEnum.optional(),
    variant: variantEnum.optional(),
    class: z.string().optional(),
  })
}

function createImageSchema() {
  return z.object({
    src: z.string().nonempty().editor({ input: 'media' }),
    alt: z.string().optional(),
    loading: z.enum(['lazy', 'eager']).optional(),
    srcset: z.string().optional(),
  })
}

export const collections = {
  index: defineCollection({
    source: '0.index.yml',
    type: 'page',
    schema: z.object({
      headline: z.string().optional(),
      hero: z.object(({
        links: z.array(createLinkSchema()),
      })),
      sections: z.array(
        createBaseSchema().extend({
          id: z.string().nonempty(),
          headline: z.string().optional(),
          orientation: orientationEnum.optional(),
          reverse: z.boolean().optional(),
          features: z.array(createFeatureItemSchema()),
        }),
      ),
      features: createBaseSchema().extend({
        headline: z.string().optional(),
        items: z.array(createFeatureItemSchema()),
      }),
      testimonials: createBaseSchema().extend({
        headline: z.string().optional(),
        items: z.array(
          z.object({
            quote: z.string().nonempty(),
            user: z.object({
              name: z.string().nonempty(),
              description: z.string().nonempty(),
              to: z.string().nonempty().optional(),
              target: z.string().nonempty().optional(),
              avatar: createImageSchema(),
            }),
          }),
        ),
      }),
      cta: createBaseSchema().extend({
        links: z.array(createLinkSchema()),
      }),
    }),
  }),
  docs: defineCollection({
    source: '1.docs/**/*',
    type: 'page',
  }),
  pricing: defineCollection({
    source: '2.pricing.yml',
    type: 'page',
    schema: z.object({
      headline: z.string().optional(),
      plans: z.array(
        z.object({
          title: z.string().nonempty(),
          planId: z.string(),
          description: z.string().nonempty(),
          price: z.object({
            month: z.string().nonempty(),
            year: z.string().nonempty(),
          }),
          button: createLinkSchema(),
          features: z.array(z.string().nonempty()),
          highlight: z.boolean().optional(),
          scale: z.boolean().optional(),
        }),
      ),
      logos: z.object({
        title: z.string().nonempty(),
        icons: z.array(z.string()),
      }),
      faq: createBaseSchema().extend({
        items: z.array(
          z.object({
            label: z.string().nonempty(),
            content: z.string().nonempty(),
          }),
        ),
      }),
    }),
  }),
  blog: defineCollection({
    source: '3.blog.yml',
    type: 'page',
  }),
  posts: defineCollection({
    source: '3.blog/**/*',
    type: 'page',
    schema: z.object({
      image: z.object({ src: z.string().nonempty().editor({ input: 'media' }) }),
      authors: z.array(
        z.object({
          name: z.string().nonempty(),
          to: z.string().nonempty(),
          avatar: z.object({ src: z.string().nonempty().editor({ input: 'media' }) }),
        }),
      ),
      date: z.date(),
      badge: z.object({ label: z.string().nonempty() }),
    }),
  }),
  changelog: defineCollection({
    source: '4.changelog.yml',
    type: 'page',
  }),
  versions: defineCollection({
    source: '4.changelog/**/*',
    type: 'page',
    schema: z.object({
      title: z.string().nonempty(),
      description: z.string(),
      date: z.date(),
      image: z.string(),
    }),
  }),
  developer: defineCollection({
    source: '5.developer.yml',
    type: 'page',
    schema: z.object({
      headline: z.string().optional(),
      notice: z.object({
        title: z.string().nonempty(),
        description: z.string().optional(),
      }).optional(),
      hero: z.object({
        links: z.array(createLinkSchema()),
      }),
      sections: z.array(
        createBaseSchema().extend({
          id: z.string().optional(),
          headline: z.string().optional(),
          orientation: orientationEnum.optional(),
          reverse: z.boolean().optional(),
          features: z.array(createFeatureItemSchema()),
        }),
      ),
      features: createBaseSchema().extend({
        headline: z.string().optional(),
        items: z.array(createFeatureItemSchema()),
      }),
      resources: createBaseSchema().extend({
        headline: z.string().optional(),
        items: z.array(
          createFeatureItemSchema().extend({
            to: z.string().optional(),
            target: z.string().optional(),
          }),
        ),
      }),
      pricing: createBaseSchema().extend({
        headline: z.string().optional(),
        items: z.array(
          z.object({
            title: z.string().nonempty(),
            description: z.string().nonempty(),
            price: z.string().nonempty(),
            period: z.string().optional(),
            highlight: z.boolean().optional(),
            features: z.array(z.string().nonempty()),
            cta: createLinkSchema(),
          }),
        ),
      }),
      cta: createBaseSchema().extend({
        links: z.array(createLinkSchema()),
      }),
    }),
  }),
}
