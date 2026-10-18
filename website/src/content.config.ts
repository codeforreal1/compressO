import { glob } from 'astro/loaders'

import { defineCollection, z } from 'astro:content'

const blogs = defineCollection({
  loader: glob({ base: './src/content/blogs', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      publishedDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      heroImage: image().optional(),
    }),
})

/** The app's CHANGELOG.md (at the repository's root), read whenever the site is built */
const changelog = defineCollection({
  loader: glob({ base: '..', pattern: 'CHANGELOG.md' }),
})

export const collections = { blogs, changelog }
