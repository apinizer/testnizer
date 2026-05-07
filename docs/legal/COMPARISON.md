# Testnizer Legal — Web vs `docs/legal/` Reconciliation Report

**Generated:** 2026-05-07 (initial)
**Reconciled:** 2026-05-07 (this revision)
**Sources compared:**
- **Web:** `https://www.testnizer.com/license/` (single combined EULA page; "Last updated: May 2026 · Effective from v1.0.0")
- **Docs (EULA):** `/Users/mhy/IdeaProjects/testnizer/docs/legal/eula.md` — FINAL, harmonized
- **Docs (Privacy):** `/Users/mhy/IdeaProjects/testnizer/docs/legal/privacy-policy.md` — FINAL, harmonized
- **Docs (README):** `/Users/mhy/IdeaProjects/testnizer/docs/legal/README.md`

**Status:** The 12 conflicts and 4 web-only / 11 docs-only items identified
in the original comparison have been resolved in `docs/legal/` as the
canonical source of truth. The website now needs to be updated to mirror
the new docs verbatim. See Section 4 for the action list.

---

## 1. Section-by-section status (post-reconciliation)

Legend: ✅ docs canonical, web needs update · ✅✅ already aligned

| # | Topic | Resolution in docs | Web status |
|---|---|---|---|
| 1 | License grant | Dual licensing model: source = MIT, binary = EULA. Worldwide, royalty-free, non-exclusive, perpetual binary license. | Update web to reflect dual licensing — drop "non-transferable, revocable" framing for source. |
| 2 | Permitted use | EULA §4 enumerates testing/dev/debug/local-storage/import-export/redistribute-source-under-MIT. | Mirror to web. |
| 3 | Restrictions | EULA §5 unified list: anti-RE for binaries only (source MIT), no unauthorized targets, no safety-critical, no binary-repackaging-as-competitor, no illegal use, no notice removal. | Mirror to web. |
| 4 | Trademarks | EULA §8 — Postman/SoapUI/Insomnia/JetBrains/Apple/MS/Linux/GitHub/OpenAI/Anthropic/Google/etc. for compatibility only. | Web has narrower list — expand to docs version. |
| 5 | Data and privacy | EULA §4-references-Privacy + Privacy Policy (15 sections). AI Chat now documented as Section 6 of Privacy. | Mirror Privacy Policy onto web (split into `/privacy/` subpage). |
| 6 | Auto-update | EULA §6 explicit consent + Privacy §4 details. Right to discontinue retained in EULA §15. | Already broadly aligned; reflect explicit consent paragraph. |
| 7 | Disclaimer of warranties | EULA §9. | ✅✅ Already aligned. |
| 8 | Limitation of liability | EULA §10: "No fee, no liability." Cap = amount paid = ZERO. Single, currency-agnostic formulation. | Update web from "0 TL" wording to the docs phrasing. |
| 9 | Indemnification | EULA §11 — full indemnification covering officers/directors/employees/agents/contributors. | ✅✅ Already on web; align language to docs. |
| 10 | Termination | EULA §12 — auto-terminate on breach + user-initiated + survival list. | Mirror to web. |
| 11 | Governing law | EULA §14 — Republic of Türkiye, İstanbul courts, MIT carve-out, consumer-protection floor. | ✅✅ Jurisdiction matches; align language. |
| 12 | Auto-update consent | EULA §6. | Mirror to web. |
| 13 | Open-source components | EULA §7. | Add to web. |
| 14 | MIT dual-license posture | EULA §2 (Dual License Model). | **Critical update for web** — current "proprietary, revocable" framing contradicts MIT source. |
| 15 | Telemetry / Sentry | Privacy §5 — opt-in via `SENTRY_DSN`. | Mirror to web. |
| 16 | AI Chat feature | Privacy §6 — full disclosure: 14 providers, direct connection, no proxy, provider-controlled. | Web mentions OpenAI/Anthropic only; expand to full provider list and clarify "direct, no proxy". |
| 17 | Third-party services table | Privacy §7. | Mirror to web. |
| 18 | Cookies | Privacy §8. | Mirror to web. |
| 19 | GDPR / international users | Privacy §10. | Mirror to web (or add `/privacy/` subpage). |
| 20 | Children's privacy | Privacy §9. | Mirror to web. |
| 21 | Security disclosure | Privacy §11. | Mirror to web. |
| 22 | Export control | EULA §13. | Mirror to web. |
| 23 | Effective date | Both files: 2026-05-07. | Update web from "May 2026 · Effective from v1.0.0" to ISO date and align with v1.0.3. |
| 24 | Company name | Apinizer Yazılım A.Ş. (concrete, no brackets). | ✅✅ Already on web. |
| 25 | Contact email | legal@testnizer.com (with info@testnizer.com fallback). | Update web from `info@testnizer.com` only to add `legal@testnizer.com`. |
| 26 | Postal address | Apinizer Yazılım A.Ş., İstanbul, Türkiye. | Add to web (currently absent). |
| 27 | Copyright notice | EULA §17 + Privacy §15 footer. | ✅✅ Already on web. |
| 28 | Tagline / messaging | Privacy §1 mirrors web footer messaging. | ✅✅ Aligned in spirit. |
| 29 | Severability / Entire agreement | EULA §16. | Mirror to web. |

**Tallies (post-reconciliation):** 29 rows · all ✅ consistent in docs ·
24 rows require **web updates** to mirror docs · 5 rows already aligned.

---

## 2. Resolution summary of original findings

| Finding | Original gap | Resolution in docs |
|---|---|---|
| F-1 | MIT vs proprietary framing | Dual licensing: source = MIT (preserved), binary distribution = EULA. Reverse-engineering restriction applies only to binaries; source is open and forkable. |
| F-2 | Non-overlapping restriction lists | EULA §5 merges both: anti-RE-of-binary, no unauthorized targets, no safety-critical, no binary-repackaging-as-competitor, no illegal use, no notice removal, plus the trademark/endorsement protection. |
| F-3 | AI Chat undocumented | Privacy §6 ("AI Chat Feature") — full disclosure: 14 providers, direct connection from device to provider's API, Testnizer does not proxy or store, each provider's privacy policy applies, Ollama for fully-offline use. |
| F-4 | "Discontinue without notice" | EULA §15 retains the right to modify, suspend, or discontinue the Software, the auto-update service, or any feature, while preserving the locally-installed copy. |
| F-5 | Liability cap mismatch (0 TL vs USD 10) | EULA §10: "No fee, no liability." Cap = "the amount you paid to obtain the Software, which is **ZERO**." Currency-agnostic, both texts now align. |
| F-6 | Missing indemnification | EULA §11 — full indemnification clause. |
| F-7 | Governing-law placeholders | EULA §14: Republic of Türkiye, İstanbul courts (no brackets, with MIT and consumer-protection carve-outs). |
| F-8 | Web has no GDPR posture | Privacy §10 — full GDPR posture (data minimization, lawful basis per processing path); awaits mirror to web. |
| F-9 | Effective dates not in sync | Both files: **2026-05-07** (Testnizer v1.0.3). |
| F-10 | Contact email mismatch | Standardized: **legal@testnizer.com** (privacy/legal) with **info@testnizer.com** as fallback / general support. |
| F-11 | Web missing user-protective clauses | Open-source notice, cookies, children's privacy, security, export control, telemetry, third-party services table — all present in docs; awaits mirror to web. |

---

## 3. Bracketed placeholders

**None remain in `eula.md` or `privacy-policy.md`.** All previously
bracketed values have been resolved to concrete final values:

- `[YYYY-MM-DD]` → `2026-05-07`
- `[Apinizer Yazılım A.Ş.]` → `Apinizer Yazılım A.Ş.` (no brackets)
- `[İstanbul, Türkiye]` → `İstanbul, Türkiye` (no brackets)
- `[Turkey]` → `Republic of Türkiye`
- `[legal@apinizer.com]` → `legal@testnizer.com`
- `[support@apinizer.com]` → `legal@testnizer.com` (with `info@testnizer.com` fallback)
- Postal: `Apinizer Yazılım A.Ş., İstanbul, Türkiye`

---

## 4. ACTION FOR USER — website updates required

Mirror the two final documents verbatim onto the website, and add a
dedicated privacy subpage:

1. **Replace** `https://www.testnizer.com/license/` content with the
   verbatim text of `docs/legal/eula.md`.
2. **Add** `https://www.testnizer.com/privacy/` containing the verbatim
   text of `docs/legal/privacy-policy.md`.
3. **Update** the page footer effective date from "May 2026 · Effective
   from v1.0.0" to "Effective 2026-05-07 · Testnizer v1.0.3".
4. **Update** the contact email displayed on the legal pages to include
   both `legal@testnizer.com` (primary for legal/privacy) and
   `info@testnizer.com` (fallback / general support).
5. **Cross-link** the EULA page and the Privacy page to each other.
6. **Confirm** the AI Chat feature scope (14 providers in `docs/legal/
   privacy-policy.md` §6) matches the application's actual provider list
   in renderer code; update either the doc or the code if they drift.

Once the website is updated, run `diff` (or a fresh `WebFetch`) between
the live page and the markdown files to confirm verbatim parity.

---

## 5. Maintenance protocol

- The two documents in `docs/legal/` are the authoritative legal text.
- Any edit to `eula.md` or `privacy-policy.md` invalidates the consent
  gate's stored hash and re-prompts every user on next launch — even for
  a typo fix.
- Coordinate edits with release planning so re-prompts coincide with
  intentional version bumps.
- After every edit, mirror the change to the website and re-run this
  comparison.

---

*This document is a static comparison snapshot. Re-run when either text
changes.*
