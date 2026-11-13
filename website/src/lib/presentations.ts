/**
 * Presentations registry — powers /resources/presentations and its Turkish
 * twin, and the deck routes under them.
 *
 * Each deck is one Astro component (src/components/deck/*Deck.astro) whose
 * slide text is written once, EN and TR side by side. It is rendered twice:
 * /resources/presentations/<slug>/ in English and
 * /tr/resources/presentations/<slug>/ in Turkish. The slide count shown on the
 * cards is counted from the deck source, so it cannot drift.
 */
import overviewSource from '../components/deck/OverviewDeck.astro?raw'
import gettingStartedSource from '../components/deck/GettingStartedDeck.astro?raw'

export type Lang = 'en' | 'tr'

export interface Presentation {
  slug: string
  title: Record<Lang, string>
  /** Short name used in each slide's footer. */
  short: Record<Lang, string>
  description: Record<Lang, string>
  format: Record<Lang, string>
  topics: Record<Lang, string[]>
  /** ISO date the deck was published or last refreshed. */
  date: string
  slides: number
}

const countSlides = (source: string): number => (source.match(/<Slide[\s>]/g) ?? []).length

export const presentations: Presentation[] = [
  {
    slug: 'testnizer-overview',
    title: {
      en: 'Testnizer — the offline API and AI client',
      tr: 'Testnizer — çevrimdışı API ve yapay zeka istemcisi',
    },
    short: { en: 'Product overview', tr: 'Ürün tanıtımı' },
    description: {
      en: 'What Testnizer is and who it is for: eight API protocols, the MCP client and its security scan, AI Chat with MCP tools, HTTP, SSE, AI and MCP mock servers, the Runner, Postman compatibility, the security toolbox, and how your data stays on your machine.',
      tr: "Testnizer nedir, kimin için: sekiz API protokolü, MCP istemcisi ve güvenlik taraması, MCP araçlarını çağırabilen AI Chat, HTTP, SSE, AI ve MCP mock sunucuları, Runner, Postman uyumluluğu, güvenlik araç kutusu ve verinizin neden makinenizde kaldığı.",
    },
    format: { en: 'Overview deck', tr: 'Tanıtım sunumu' },
    topics: { en: ['Product', 'AI & MCP', 'Privacy'], tr: ['Ürün', 'Yapay zeka & MCP', 'Gizlilik'] },
    date: '2026-11-13',
    slides: countSlides(overviewSource),
  },
  {
    slug: 'testnizer-getting-started',
    title: {
      en: 'Getting started with Testnizer — a hands-on tour',
      tr: 'Testnizer ile başlarken — uygulamalı tur',
    },
    short: { en: 'Getting started', tr: 'Başlarken' },
    description: {
      en: 'Step by step, from installing the app to your first request, environments and variables, auth, scripts and tests, the Runner and its report, a mock server, an MCP server and its security scan, AI Chat with MCP tools, a Postman import and working as a team through Git. Every step says what to do, where to click and what you will see.',
      tr: "Adım adım: uygulamayı kurmaktan ilk isteğe, ortamlar ve değişkenler, kimlik doğrulama, script'ler ve testler, Runner ve raporu, bir mock sunucu, bir MCP sunucusu ve güvenlik taraması, MCP araçlarıyla AI Chat, Postman'den içe aktarma ve Git ile ekip çalışmasına kadar. Her adım ne yapacağınızı, nereye tıklayacağınızı ve ne göreceğinizi söyler.",
    },
    format: { en: 'Training deck', tr: 'Eğitim sunumu' },
    topics: { en: ['Training', 'Getting started', 'MCP'], tr: ['Eğitim', 'Başlarken', 'MCP'] },
    date: '2026-11-13',
    slides: countSlides(gettingStartedSource),
  },
]

export const deckPath = (lang: Lang, slug: string): string =>
  `${lang === 'tr' ? '/tr' : ''}/resources/presentations/${slug}/`

export const indexPath = (lang: Lang): string => `${lang === 'tr' ? '/tr' : ''}/resources/presentations/`

export const langOf = (pathname: string): Lang =>
  pathname === '/tr' || pathname.startsWith('/tr/') ? 'tr' : 'en'
