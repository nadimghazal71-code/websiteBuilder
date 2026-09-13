# Sitely — wireframe analysis

Derived from *Multi-Tenant Website Builder for Local Businesses — Technical Kickoff v1.0*.
Fidelity is deliberately low: these wireframes settle **structure, flow and constraints**, not
visual design. Colour is limited to one warm accent for interactive elements and one flag colour
for the rules the kickoff says not to break.

Canvas: <https://claude.ai/code/artifact/8c6bce75-e7c0-46ef-ac40-39862ba3ab9d>
Source artboards: [`design/`](../design) — see [`design/README.md`](../design/README.md).

---

## 1. What the document actually constrains

Five things in the kickoff are not preferences; they decide what the screens can look like.

| Constraint | Source | Consequence for the UI |
|---|---|---|
| A site is **one JSON document** validated against a category schema | §0, §4.5 | The content editor is a *generated form*, not a hand-built page per category. There is no "design your own layout" surface anywhere. |
| A template **may not invent a field** | §5.1 | Template switching is non-destructive and can therefore be a first-class, always-available control — not a scary one-way migration. |
| Renderer sits on a **different registrable domain** | §2 | The panel and the renderer are never the same app shell. Nothing in the editor previews inside the panel's own origin — preview is a signed, short-lived URL on the renderer. |
| Showcase only — **no cart, no checkout** | §5.0 | Every tenant page ends in exactly five actions: call, WhatsApp, directions, contact form, external link. The sticky bar is the whole conversion design. |
| Rich text is stored as **JSON, never HTML** | §4.3, §6.7 | The editor's rich-text affordance is a restricted toolbar, not a free HTML field. Reflected in the `richtext` field treatment. |

Two commercial constraints shape screens just as hard:

- **Pay-to-publish, not pay-to-edit** (§8.1). The paywall is a step inside the wizard, not a gate in
  front of it. This is the single biggest layout consequence of a business decision in the whole set.
- **Churn is the game** (§1.1, §14.3). The owner dashboard leads with calls and WhatsApp taps, not
  with pageviews — the stat that renews a subscription is "47 people phoned you".

---

## 2. Information architecture

Three deployables, two authenticated role trees, one public renderer.

```
app.sitely.com  (control panel)
├─ /                         marketing
├─ /login                    no public signup — admin creates accounts
├─ /invite/:token            accept invite, set first password
├─ /dashboard                OWNER
│  ├─ /                      site status, stats, messages
│  ├─ /editor                the 6-step wizard
│  ├─ /messages              contact submissions
│  ├─ /domain                subdomain + custom-domain upsell
│  └─ /billing               plan, invoices (ZATCA)
└─ /admin                    ADMIN / SUPER_ADMIN — TOTP mandatory
   ├─ /metrics               MRR, funnel, needs-attention, audit tail
   ├─ /businesses            list, detail, new (single transaction)
   ├─ /leads                 pipeline board + build-demo
   ├─ /categories            module manifest registry
   ├─ /templates             template registry
   └─ /audit-logs            append-only

*.sitelypages.com  (renderer)
└─ middleware → /_sites/[key] → published JSON → template → ISR
```

The editor wizard is fixed at six steps, per §5.11: **Category → Template → Palette → Content →
Preview → Publish**. Category locks after first publish (it determines the module set); template and
palette stay switchable forever (they cannot lose content).

---

## 3. Screen inventory

### System map — `SystemMap.dc.html`
The three deployables, the data stores, the four-layer content model, the onboarding flow, the
publish path and the build order on one board. Carries the domain-isolation rule (§2) as a
full-width callout because it is the one decision that is expensive to reverse.

### Owner editor — 5 artboards
| Artboard | What it settles |
|---|---|
| `Main` — content step | The generated form. Left rail = universal sections + this category's modules with on/off toggles; centre = the open module rendered from its field definitions; right = live preview + a pre-flight panel. Autosave is a status, publish is a button. |
| `EditorTemplate` | Only templates whose `supportedModules` cover the category's required modules are offered; an incompatible one is shown disabled *with the reason*, not hidden. |
| `EditorPalette` | Eight fixed palettes, seven tokens each, contrast report visible. Custom colours are gated to Pro on purpose (§5.9). |
| `EditorPublish` | Pre-flight checklist, then the paywall, then what publishing actually does, then version history with restore. |
| `OwnerDashboard` | Calls / WhatsApp / directions first, one single-series trend, messages inbox, domain and billing. |

### Admin console — 4 artboards
| Artboard | What it settles |
|---|---|
| `AdminMetrics` | MRR, active, past-due, churn, demos, plus a "needs you today" queue and the audit tail. |
| `AdminNewBusiness` | The single-transaction create form, with the reserved-subdomain error shown live and a panel stating exactly which documents the submit creates. |
| `AdminLeads` | The prospect board, a lead drawer with the outreach log and the `build-demo` job state, and the PDPL / Places-caching constraints on the surface. |
| `AdminRegistry` | The category manifest editor — module list with order, required flags, bilingual label overrides, plus the template-coverage matrix and the schema-version publish path. This is phase 2 and the load-bearing screen. |

### Tenant sites — 3 artboards
| Artboard | What it settles |
|---|---|
| `SiteServiceLed` | Archetype B on a 390px phone: hero with two CTAs, price list, team, before/after, hours with prayer-closure note, map, sticky call/WhatsApp/directions bar at 46px targets. |
| `SiteMenuLed` | Archetype A, **Arabic and RTL**, with delivery-provider links and a Ramadan hours note. Same skeleton, `dir` flipped — proving the layout survives without a second template. |
| `SiteStates` | The demo site (banner, noindex, expiry, no borrowed logo) and the grace-expired page (503, never a 404). |

---

## 4. Decisions the wireframes assume

These are §13's open questions. The wireframes had to pick; each is easy to change and each is marked
on the canvas.

| # | Question | Assumed | Why |
|---|---|---|---|
| 1 | Pay-to-edit vs pay-to-publish | **Pay-to-publish** | The kickoff recommends it (§8.1) and it is the higher-conversion shape. |
| 3 | Monthly only vs annual | **Both, annual preselected** | §1.1 — annual prepay fixes churn, cash flow and payment failure at once. |
| 4b | Wave-1 categories | **barber, ladies_salon, restaurant, cafe** | §5.7. The artboards use barber (archetype B) and cafe (archetype A). |
| 5 | Arabic-first / English-first / bilingual | **Per-site locale, both first-class** | §5.10. One tenant artboard is Arabic RTL specifically to prove the template does not fork. |
| — | Currency display | SAR, VAT shown explicitly, Arabic-Indic numerals as a per-site setting | §1.4, §5.10 |

Still genuinely open, and worth answering before phase 4 starts:

- **Which gateway** (§13.2). The billing screens show Mada explicitly; if the chosen gateway cannot do
  recurring tokenized billing on Mada, the billing flow changes shape, not just its copy.
- **Media quota UI.** §4.7 sets a per-business quota (200 files / 500 MB) but the kickoff never says
  what the owner sees when they hit it. Not wireframed.
- **Impersonation write mode.** §6.6 makes it read-only by default; the escalation path to a writing
  session is referenced in the version history but not designed.

---

## 5. What is deliberately not wireframed

- Marketing pages for `app.sitely.com` — a separate brief, and they need real positioning copy first
  (§13.7: "a website for SAR 79/mo" is a weak pitch).
- Custom-domain verification UI — phase 9, explicitly gated behind 20 paying customers (§12).
- The remaining 14 templates and ~41 categories. The point of the archetype model is that they are
  configuration; wireframing them would be the exact sprawl §14.1 warns against.
- Email templates (invite, dunning, the monthly stats email). The stats email is arguably the most
  commercially important surface in the product and deserves its own pass.
