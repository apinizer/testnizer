import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'

const schema = z.object({
  title: z.string(),
  description: z.string().optional(),
  order: z.number().default(100),
  section: z.string().default('Guides'),
})

const docs = defineCollection({
  loader: glob({ pattern: ['**/*.{md,mdx}', '!tr/**'], base: './src/content/docs' }),
  schema,
})

const docsTr = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs/tr' }),
  schema,
})

export const collections = { docs, docsTr }
