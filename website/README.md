# Testnizer website

Marketing site and documentation for [Testnizer](https://github.com/apinizer/testnizer) — the offline API client for teams who can't paste tokens into the cloud. This is the `website/` subdirectory of the Testnizer monorepo.

Live at [www.testnizer.com](https://www.testnizer.com).

## Stack

- [Astro 5](https://astro.build/) (static site, server-rendered at build time)
- [Tailwind CSS v4](https://tailwindcss.com/) via the official Vite plugin
- [Shiki](https://shiki.style/) for code highlighting
- [`@astrojs/mdx`](https://docs.astro.build/en/guides/integrations-guide/mdx/) for documentation pages
- Deployed to GitHub Pages via the repo-root `.github/workflows/website-deploy.yml` (monorepo: GitHub only runs workflows from the root `.github/`)

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
```

## Build

```sh
npm run build    # outputs to dist/
npm run preview  # serves the build locally
```

## Project layout

```
src/
├── components/      # Nav, Footer, GuaranteeCard, DocsSidebar, icons
├── content/
│   └── docs/        # Markdown documentation (auto-routed under /docs/<slug>)
├── layouts/         # BaseLayout, DocsLayout
├── pages/           # /, /features, /security, /download, /license, /docs
├── styles/global.css
└── content.config.ts
public/
├── favicon.svg
├── CNAME            # www.testnizer.com
└── robots.txt
```

Deploy lives at the repo root, not here: `../.github/workflows/website-deploy.yml`.

## Adding a doc page

Drop a Markdown file in `src/content/docs/` with frontmatter:

```yaml
---
title: My new guide
description: One-line summary.
order: 5
section: Guides
---
```

Sections are sorted by `order` within the section, and `Getting started` →
`Guides` → `Protocols` → `Tools` → `Reference` overall.

## Branding

- Accent: `#7c73e6` (Testnizer purple)
- Tone: enterprise, confident, not sarcastic. We don't make jokes about
  Postman; we describe the offline guarantees that compliance teams actually
  ask for.

## License

The site source is MIT-licensed. The Testnizer name and logo are project marks
of Apinizer.
