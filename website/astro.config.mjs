import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: 'https://www.testnizer.com',
  i18n: {
    locales: ['en', 'tr'],
    defaultLocale: 'en',
    routing: { prefixDefaultLocale: false },
  },
  integrations: [mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  markdown: { shikiConfig: { theme: 'github-dark-dimmed', wrap: true } },
})
