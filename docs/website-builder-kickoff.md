# Multi‑Tenant Website Builder for Local Businesses — Technical Kickoff

**Stack:** Next.js (App Router) · NestJS · MongoDB (Mongoose) · Redis · S3‑compatible storage
**Version:** 1.0 — kickoff / pre‑development
**Audience:** you (founder + engineer), and whoever joins later

---

## 0. Executive summary

You are building a **productized website service**, not a website agency. The product is three
deployables sharing one backend:

| # | App | Domain (example) | Purpose |
|---|-----|------------------|---------|
| 1 | **Control panel** (Next.js) | `app.sitely.com` | Marketing pages + admin console + owner editor |
| 2 | **Renderer** (Next.js) | `*.sitelypages.com` | Serves every customer's public site |
| 3 | **API** (NestJS) | `api.sitely.com` | Auth, content, billing, publishing, leads |

**Scope:** these are **showcase sites — no cart, no checkout, no inventory.** Visitors convert by
calling, messaging on WhatsApp, or getting directions. The only money in the system is your
subscription (see §5.0 for why this constraint is worth keeping).

The core technical insight: **a site is data, not code.** Every customer site is one JSON document
validated against a *category schema*, rendered by one of N React templates. Adding a customer =
inserting a document. Adding a template = adding a React component that consumes an existing schema.
Nothing is ever generated per‑customer at the code level.

---

## 1. Honest read on the business model (read this before you write code)

I'd be doing you a disservice by skipping straight to schemas. Five things will decide whether this
works, and four of them are not engineering problems.

**1.1 — Churn is the whole game, not acquisition.**
At $20/mo, a customer who cancels after 3 months earns you $60 against your acquisition cost. If your
outreach converts at 2% and you spend any money or meaningful time per lead, the math breaks. Build
**annual prepay** (e.g. $200/yr) into v1 pricing, not v2. It solves churn, cash flow, and payment
failure in one move.

**1.2 — Google Maps data has legal limits.**
The Places API terms restrict caching: you may store `place_id` indefinitely, but most other fields
have a short caching window (historically 30 days) and scraping the Maps UI directly violates ToS.
**Design decision:** store `place_id` + your own enrichment permanently; treat name/phone/address as
a refreshable cache with a TTL. Re‑fetch rather than hoard. Verify the current terms before launch —
they change.

**1.3 — Do not build a demo using their logo and photos.**
Cloning a business's brand assets into a live public URL before they've paid is a trademark/copyright
exposure and it reads as creepy. Build the demo from **public facts only** (name, category, address,
hours, phone) with stock/AI imagery and a clear `DEMO — not affiliated` banner, `noindex`, and an
expiry. This is also faster to automate.

**1.4 — Saudi context (you're in Riyadh).**
- **PDPL** applies to personal data you collect while prospecting. Business phone numbers of sole
  traders are personal data. Keep a lawful basis, a deletion path, and an unsubscribe.
- Unsolicited commercial SMS/WhatsApp is regulated by CITC. Prefer in‑person / phone / walk‑in
  outreach for v1 — it converts far better for barbers and restaurants anyway.
- **VAT 15%** on B2B SaaS if you're a registered KSA entity. Price in SAR (e.g. **SAR 79/mo**), show
  VAT explicitly, and plan for **ZATCA e‑invoicing (Fatoora)** — your invoices must be compliant.
  This is a real integration, not a checkbox. Budget for it.
- **Payments:** Stripe's merchant availability for KSA‑registered entities is unclear and changes —
  verify directly. Local gateways (**Moyasar, Tap, Paylink, HyperPay, PayTabs, Geidea, MyFatoorah**)
  support **Mada**, which matters: a large share of Saudi cards are Mada debit and will fail on
  international‑card‑only gateways. **Recurring/tokenized billing support on Mada is the single
  question to ask every gateway before you pick one.**

**1.5 — Scope discipline.**
You said the category list will be long — good, the market is long. But "N categories × 5 templates"
is a trap: 20 categories would mean 100 templates to design, build, test, and maintain. §5 solves
this by building templates per **archetype** rather than per category, so ~18 templates cover ~45
categories.

Even so: **launch with 4 categories and 4 templates.** Ship wave 1 from §5.7, sell it, then let
demand pick wave 2. The architecture supports 45 categories on day one; your calendar does not.

---

## 2. System architecture

```
                      ┌──────────────────────────────────┐
                      │  app.sitely.com  (Next.js)       │
                      │  • marketing pages               │
                      │  • /login  (no signup)           │
                      │  • /admin/*   — role: ADMIN      │
                      │  • /dashboard/* — role: OWNER    │
                      └───────────────┬──────────────────┘
                                      │ HTTPS + httpOnly cookie
                                      ▼
  ┌────────────┐             ┌──────────────────────────┐        ┌──────────────┐
  │  MongoDB   │◄────────────┤   api.sitely.com (Nest)  ├───────►│   Redis      │
  │  (Atlas)   │             │  Auth │ Sites │ Billing  │        │ cache+queue  │
  └────────────┘             │  Media│ Leads │ Domains  │        └──────────────┘
                             └──────┬─────────────┬─────┘
                                    │             │ on publish: purge + revalidate
              presigned PUT ────────┘             ▼
  ┌────────────┐                        ┌──────────────────────────────────┐
  │ S3 / R2    │◄───────────────────────┤ *.sitelypages.com  (Next.js)     │
  │  + CDN     │   read via CDN         │  middleware → resolve host       │
  └────────────┘                        │  ISR, cached site JSON           │
                                        └──────────────────────────────────┘
```

**Why a separate Nest API instead of Next.js route handlers?**
You get one backend serving two frontends, real background jobs (BullMQ), webhook workers, and
cron — none of which belong in a serverless Next runtime. You already chose Nest; it's the right call
for this shape.

**Critical isolation rule:** the renderer must live on a **different registrable domain** from the
control panel (`sitelypages.com` vs `sitely.com`), *not* just a different subdomain. Reason: if you
ever set an auth cookie on `.sitely.com`, every tenant subdomain receives it, and any XSS on any
customer site — including content they typed themselves — becomes full account takeover on your
admin. Two domains makes that structurally impossible. **This is the single highest‑value security
decision in the document.**

---

## 3. Domain & tenancy strategy (your question #2)

Four options. Compared on what actually matters for a $20/mo product: SEO value to the customer,
operational cost, and how much support work it creates for you.

### Option A — Path‑based · `sitelypages.com/barber-joe`

| | |
|---|---|
| **SSL** | One certificate. Nothing to automate. |
| **Cost** | $0 |
| **SEO** | Weakest. All tenants share one domain's authority — which sounds good but means one spammy customer can drag everyone down, and Google treats it as one site with thin subfolders. |
| **Ops** | Trivial. |
| **Perception** | Looks like a directory listing, not "their website." Hard to sell. |

### Option B — Subdomain · `barber-joe.sitelypages.com` ✅ **recommended default**

| | |
|---|---|
| **SSL** | One **wildcard cert** `*.sitelypages.com` via Let's Encrypt **DNS‑01** challenge. Auto‑renews. Covers unlimited tenants. |
| **DNS** | One wildcard `A`/`CNAME` record. New tenant = zero DNS work. |
| **Cost** | ~$10–15/yr for the domain. Cert free. |
| **SEO** | Good. Google treats subdomains as largely separate sites. Strong enough for local/map‑pack intent, which is all these businesses need. |
| **Ops** | Near zero. Provisioning is an insert, not an infra change. |
| **Caveat** | Cloudflare's *free* Universal SSL covers only one level of wildcard (`*.example.com`, not `*.*.example.com`) — fine here. |

### Option C — Custom domain · `barberjoe.sa` 💰 **paid add‑on, not v1**

| | |
|---|---|
| **SSL** | Per‑domain cert, issued on demand. Automatable via Caddy `on_demand_tls`, Traefik + LE, Vercel Domains API, or **Cloudflare SSL for SaaS / Custom Hostnames**. |
| **Cost** | Cloudflare SSL for SaaS: roughly **$5/mo base with ~100 hostnames included, then ~$0.10/hostname/mo** (verify current pricing). Vercel bills per domain on some plans — check before committing. Domain registration itself is the customer's cost (~$10–15/yr, `.sa` differs). |
| **SEO** | Best. It's genuinely their asset. |
| **Ops** | **This is where your support burden lives.** Customers cannot configure DNS. Expect tickets on every single one. |
| **Verdict** | Charge for it (+$5–8/mo or a one‑time $30 setup). It pays for the support time and filters for serious customers. |

### Option D — Hybrid ✅ **the actual answer**

Ship **B** as the default for everyone. Offer **C** as a paid upgrade once you have ≥20 paying
customers and the publish pipeline is boring. Model the schema for C from day one (see
`businesses.domain`) so adding it later is a feature flag, not a migration.

### Reserved subdomains
Blocklist on slug creation: `www, api, app, admin, mail, smtp, ftp, cdn, static, assets, blog,
help, support, status, dev, staging, test, demo, dashboard, login, auth, billing, docs, new, id`.

### Host resolution in the renderer

```ts
// apps/renderer/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

const ROOT = process.env.NEXT_PUBLIC_TENANT_ROOT!; // "sitelypages.com"

export const config = {
  matcher: ['/((?!_next|favicon.ico|robots.txt|api/internal).*)'],
};

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  const url  = req.nextUrl.clone();

  let key: string;

  if (host === ROOT || host === `www.${ROOT}`) {
    return NextResponse.rewrite(new URL('/_platform', req.url)); // fallback landing
  }

  if (host.endsWith(`.${ROOT}`)) {
    key = `sub:${host.slice(0, -(ROOT.length + 1))}`;   // subdomain tenant
  } else {
    key = `domain:${host}`;                             // custom domain tenant
  }

  url.pathname = `/_sites/${encodeURIComponent(key)}${url.pathname}`;
  return NextResponse.rewrite(url);
}
```

The `/_sites/[key]` route fetches the published site JSON (Redis → Mongo), renders the template, and
is cached with ISR. On publish, the API calls `revalidateTag(\`site:\${id}\`)` so the change is live in
seconds without a rebuild.

---

## 4. Data model (MongoDB)

### Design principles

1. **Draft and published are separate documents.** Editing must never touch what the public sees.
2. **Content is one JSON tree per site**, validated against the category schema — not 40 loose fields.
   This is what makes "add a new category" a config change instead of a migration.
3. **Rich text is stored as Tiptap JSON, never HTML.** HTML is produced at render time from a
   whitelist. This closes the XSS door permanently (see §6.7).
4. **Every tenant‑owned document carries `businessId`** and every query filters on it. No exceptions.
5. Money in **minor units as integers** (`1999` = SAR 19.99). Never floats.

---

### 4.1 `users`

```js
{
  _id: ObjectId,
  email: String,            // lowercase, unique index
  passwordHash: String,     // argon2id; null until invite accepted
  role: String,             // 'SUPER_ADMIN' | 'ADMIN' | 'OWNER'
  businessId: ObjectId,     // null for admins; required for OWNER
  status: String,           // 'INVITED' | 'ACTIVE' | 'SUSPENDED'
  name: String,
  phone: String,
  locale: String,           // 'ar' | 'en'
  emailVerifiedAt: Date,

  // invite / reset — store HASHES of tokens, never the token itself
  inviteTokenHash: String,
  inviteExpiresAt: Date,
  resetTokenHash: String,
  resetExpiresAt: Date,

  // brute-force protection
  failedLoginCount: Number, // default 0
  lockedUntil: Date,

  // admin 2FA
  totpSecretEnc: String,    // encrypted at rest, admins only
  totpEnabledAt: Date,
  recoveryCodeHashes: [String],

  lastLoginAt: Date,
  passwordChangedAt: Date,  // invalidates older access tokens
  createdBy: ObjectId,
  createdAt: Date, updatedAt: Date
}
```
**Indexes:** `{ email: 1 }` unique · `{ businessId: 1 }` · `{ inviteTokenHash: 1 }` sparse ·
`{ resetTokenHash: 1 }` sparse

> **No public signup.** Admin creates the business; the system creates the user in `INVITED` state and
> emails a one‑time link. **Never email a generated password.**

---

### 4.2 `businesses`

```js
{
  _id: ObjectId,
  name: String,
  slug: String,                 // unique, [a-z0-9-], 3–40, reserved-word checked
  categoryKey: String,          // 'restaurant' | 'barber' | 'clothing' | ...
  templateKey: String,          // 'restaurant.aurora'
  paletteKey: String,           // 'warm-sand' | or 'custom'
  customPalette: {              // only when paletteKey === 'custom'
    primary: String, secondary: String, accent: String,
    bg: String, surface: String, text: String, muted: String
  },
  locale: String,               // 'ar' | 'en'
  direction: String,            // 'rtl' | 'ltr'  — derived, but stored for render speed

  status: String,               // 'DRAFT' | 'AWAITING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELED'

  domain: {
    subdomain: String,          // unique; the always-on address
    customDomain: String,       // unique sparse; null until upgraded
    customDomainStatus: String, // 'NONE'|'PENDING_DNS'|'VERIFYING'|'ACTIVE'|'FAILED'
    verificationToken: String,  // TXT record value
    sslStatus: String,          // 'NONE'|'ISSUING'|'ACTIVE'|'ERROR'
    lastCheckedAt: Date
  },

  contact: {                    // canonical NAP — also feeds JSON-LD
    phone: String, whatsapp: String, email: String,
    address: { line1, line2, city, region, country, postalCode },
    geo: { type: 'Point', coordinates: [lng, lat] },
    googlePlaceId: String
  },

  ownerUserId: ObjectId,
  leadId: ObjectId,             // provenance: which prospect became this customer
  subscriptionId: ObjectId,

  publishedSiteId: ObjectId,    // fast path for the renderer
  publishedAt: Date,
  isDemo: Boolean,              // true → noindex + demo banner + auto-expire
  demoExpiresAt: Date,

  createdBy: ObjectId,
  createdAt: Date, updatedAt: Date
}
```
**Indexes:** `{ slug: 1 }` unique · `{ 'domain.subdomain': 1 }` unique ·
`{ 'domain.customDomain': 1 }` unique sparse · `{ status: 1, categoryKey: 1 }` ·
`{ 'contact.geo': '2dsphere' }` · `{ ownerUserId: 1 }`

---

### 4.3 `categories` + `modules` — the schema registry

This is the heart of the system. It defines **what fields exist** for a category. Templates consume
it; the admin editor renders its form from it; the API validates against it.

> **Read §5 before implementing this.** A category does not define its own fields from scratch — it
> composes reusable **modules**. The final shape of both collections is in **§5.8**; the structures
> below are the underlying field primitives those modules are built from.

```js
{
  _id: ObjectId,
  key: String,                  // 'restaurant' — immutable, unique
  name: { en: String, ar: String },
  icon: String,
  schemaVersion: Number,        // bump when sections change; enables migration
  status: String,               // 'ACTIVE' | 'HIDDEN'
  sections: [ SectionDef ],
  defaultPaletteKeys: [String],
  sortOrder: Number
}
```

```js
// SectionDef
{
  key: 'menu',
  name: { en: 'Menu', ar: 'قائمة الطعام' },
  required: false,
  repeatable: false,            // true → array of entries
  maxItems: null,
  fields: [ FieldDef ]
}

// FieldDef — the allowed types (keep this list small and closed)
{
  key: 'title',
  type: 'text',                 // text | textarea | richtext | number | money | boolean
                                // | image | gallery | url | email | phone | select
                                // | color | time | weekhours | geo | list | group
  label: { en, ar },
  required: true,
  maxLength: 80,
  options: [...],               // for select
  itemFields: [ FieldDef ],     // for list/group — recursive
  maxItems: 50,
  helpText: { en, ar }
}
```

**Why a registry document rather than hard-coded TypeScript?** You can add a category from the admin
UI without a deploy. Trade‑off: you lose compile‑time types in the templates. **Mitigation:** generate
TypeScript types from the registry with a build script (`pnpm gen:types`) and commit them. Best of
both.

---

### 4.4 `templates`

```js
{
  _id: ObjectId,
  key: String,                  // 'restaurant.aurora' — unique
  categoryKey: String,
  name: { en, ar },
  description: { en, ar },
  thumbnailUrl: String,
  previewUrl: String,
  schemaVersion: Number,        // must match the category's
  supportedSections: [String],  // subset of category sections it renders
  supportsRtl: Boolean,
  allowedPaletteKeys: [String],
  status: String,               // 'ACTIVE' | 'BETA' | 'DEPRECATED'
  sortOrder: Number
}
```
**Contract (your requirement, formalized):** *all templates in a category accept the same inputs.*
Enforced by validating that the category's **required modules ⊆ `template.supportedModules`** at
registration, and by a CI test that renders every template against a golden fixture for every
category it claims to support. If a template can't render a required module, it fails CI.

See §5.6 — templates carry an `archetype` and a `supportedModules` list, which is what lets one
template serve many categories.

---

### 4.5 `sites` — draft + published

```js
{
  _id: ObjectId,
  businessId: ObjectId,
  state: String,                // 'DRAFT' | 'PUBLISHED'
  categoryKey: String,
  templateKey: String,
  schemaVersion: Number,
  paletteKey: String,
  content: {                    // keyed by section key, shape from the category schema
    brand:  { logo: {...}, name: '...', tagline: {...} },
    hero:   { headline: '...', image: {...}, ctaLabel: '...', ctaHref: '...' },
    menu:   { groups: [ { name, items: [ { name, description, price, image, tags } ] } ] },
    hours:  { mon: [{open:'09:00',close:'23:00'}], ... , note: '...' },
    // ...
  },
  seo: { title, description, ogImage, noindex: Boolean },
  integrations: {
    googleMapsEmbed: String, whatsappNumber: String,
    instagram: String, tiktok: String, snapchat: String, x: String,
    deliveryLinks: [{ provider: 'hungerstation'|'jahez'|'talabat'|'keeta', url: String }]
  },
  publishedFrom: ObjectId,      // on PUBLISHED docs: the draft it was snapshotted from
  version: Number,
  updatedBy: ObjectId,
  createdAt: Date, updatedAt: Date
}
```
**Indexes:** `{ businessId: 1, state: 1 }` unique compound · `{ updatedAt: -1 }`

Exactly two documents per business. Publishing = deep‑copy `DRAFT.content` → `PUBLISHED`, bump
`version`, archive previous into `siteVersions`, invalidate cache.

---

### 4.6 `siteVersions` — rollback history

```js
{
  _id, businessId, version: Number, snapshot: Object,
  templateKey, paletteKey, schemaVersion,
  publishedBy: ObjectId, publishedAt: Date,
  note: String
}
```
**Index:** `{ businessId: 1, version: -1 }`. Keep last 20 per business; TTL or cron‑prune the rest.

---

### 4.7 `media`

```js
{
  _id, businessId,
  key: String,                  // S3 object key: biz/<businessId>/<uuid>.webp
  url: String,                  // CDN URL
  variants: [{ width: Number, url: String }],   // 320/640/1280/1920
  blurhash: String,             // cheap LQIP for template polish
  mime: String, bytes: Number, width: Number, height: Number,
  alt: { en: String, ar: String },
  uploadedBy: ObjectId,
  status: String,               // 'PENDING' | 'READY' | 'REJECTED'
  createdAt: Date
}
```
**Index:** `{ businessId: 1, createdAt: -1 }`. Enforce a per‑business quota (e.g. 200 files / 500 MB).

---

### 4.8 `subscriptions`

```js
{
  _id, businessId,
  provider: String,             // 'moyasar' | 'tap' | 'stripe' | 'manual'
  providerCustomerId: String,
  providerSubscriptionId: String,
  planKey: String,              // 'basic_monthly' | 'basic_annual' | 'custom_domain_addon'
  amountMinor: Number,          // 7900
  currency: String,             // 'SAR'
  vatRate: Number,              // 0.15
  interval: String,             // 'month' | 'year'
  status: String,               // 'TRIALING'|'ACTIVE'|'PAST_DUE'|'CANCELED'|'UNPAID'
  currentPeriodStart: Date, currentPeriodEnd: Date,
  cancelAtPeriodEnd: Boolean,
  gracePeriodEndsAt: Date,      // how long a PAST_DUE site stays up — pick 7 days
  addons: [String],
  createdAt, updatedAt
}
```

### 4.9 `invoices`
```js
{ _id, businessId, subscriptionId, provider, providerInvoiceId,
  number: String,               // your own sequential number (ZATCA needs this)
  subtotalMinor, vatMinor, totalMinor, currency,
  status: 'PAID'|'OPEN'|'FAILED'|'REFUNDED',
  paidAt: Date, pdfUrl: String, zatcaUuid: String, zatcaQr: String,
  createdAt }
```

### 4.10 `webhookEvents` — idempotency
```js
{ _id, provider, providerEventId /* unique */, type, payload,
  status: 'RECEIVED'|'PROCESSED'|'FAILED', attempts: Number,
  error: String, processedAt: Date, createdAt: Date }
```
**Index:** `{ provider: 1, providerEventId: 1 }` unique. Insert first, process second. This is the
only thing standing between you and double‑charging someone.

---

### 4.11 `leads` — your prospecting pipeline

```js
{
  _id,
  googlePlaceId: String,        // unique — safe to store permanently
  name: String,                 // treat as cached, refresh per Places ToS
  categoryGuess: String,
  phone: String, address: String,
  geo: { type: 'Point', coordinates: [lng, lat] },
  rating: Number, reviewCount: Number,
  websiteUrl: String,           // null/absent = your target
  hasWebsite: Boolean,
  socialOnly: Boolean,          // Instagram-only businesses — great leads
  dataFetchedAt: Date,          // TTL basis for compliant caching

  status: String,               // 'NEW'|'QUALIFIED'|'DEMO_BUILT'|'CONTACTED'|'INTERESTED'
                                // |'WON'|'LOST'|'DO_NOT_CONTACT'
  demoBusinessId: ObjectId,
  assignedTo: ObjectId,
  outreach: [{ at: Date, channel: 'call'|'walkin'|'whatsapp'|'email', by: ObjectId, note: String, outcome: String }],
  lostReason: String,
  doNotContact: Boolean,        // honour this forever — PDPL
  createdAt, updatedAt
}
```
**Indexes:** `{ googlePlaceId: 1 }` unique · `{ status: 1, updatedAt: -1 }` · `{ geo: '2dsphere' }` ·
`{ dataFetchedAt: 1 }` (TTL sweep)

### 4.12 `refreshTokens` (server‑side session records)
```js
{ _id, userId, familyId: String, tokenHash: String, // sha256 of the token
  userAgent: String, ip: String,
  expiresAt: Date,  // TTL index
  revokedAt: Date, replacedBy: ObjectId, createdAt: Date }
```
**Indexes:** `{ tokenHash: 1 }` unique · `{ expiresAt: 1 }` TTL · `{ userId: 1, familyId: 1 }`

### 4.13 `auditLogs`
```js
{ _id, actorUserId, actorRole, impersonatedBusinessId,
  action: String,       // 'business.create','site.publish','user.impersonate','billing.refund'
  targetType: String, targetId: ObjectId,
  diff: Object, ip: String, userAgent: String, createdAt: Date }
```
**Index:** `{ createdAt: -1 }`, `{ targetId: 1 }`. Append‑only — no update/delete route exists.

### 4.14 `siteEvents` (lightweight analytics — gives you a retention story)
```js
{ _id, businessId, type: 'pageview'|'call_click'|'whatsapp_click'|'directions_click'|'menu_view',
  path: String, referrer: String, country: String, device: String, day: String /* '2026-09-13' */,
  createdAt: Date }
```
Roll up nightly into `siteStatsDaily { businessId, day, pageviews, calls, whatsapp, directions }`.
**"You got 47 calls from your site last month" is the email that prevents cancellation.** Build this
in v1 — it's cheap and it's your retention weapon.

### 4.15 `contactSubmissions`
```js
{ _id, businessId, name, email, phone, message, ip, userAgent,
  spamScore: Number, status: 'NEW'|'READ'|'SPAM', createdAt: Date }
```

---

## 5. Categories & templates — the content spec

This is the part that determines whether the product scales to 20 categories or collapses into 20
special cases.

### 5.0 Scope: showcase, not commerce

**No cart, no checkout, no payments between a business and its customers, no inventory.** Every site
is a *showcase*: it presents the business and pushes the visitor to **call, WhatsApp, or get
directions**. Prices are displayed as information, never as a transaction.

This is a deliberate constraint and it buys you a lot:

| You avoid | Because of it |
|---|---|
| PCI scope on tenant sites | No card data ever touches a customer site |
| Inventory/stock sync | Nothing to keep accurate |
| Order state machines, refunds, disputes | No orders exist |
| Competing with Salla / Zid / Shopify | Different product, different price point |
| Per‑merchant payment onboarding | The single biggest ops burden in e‑commerce SaaS |

The only money in the system is **your** subscription, business → you. Keep it that way. If a
customer needs a real store, the right answer is "Salla does that, we'll link to it from your site."

**Conversion actions available to a tenant site:** call · WhatsApp · directions · contact form ·
external link (their Instagram, a delivery app, a booking system, their own store). That's it.

---

### 5.1 The rule — four layers

```
module    →  a reusable block of FIELDS      ('menu', 'priceList', 'showcase', 'team', …)
category  →  picks which MODULES apply       ('restaurant' = menu + delivery + venue)
template  →  defines LAYOUT and STYLE        (renders a set of modules)
palette   →  defines COLOR TOKENS            (7 CSS variables)
```

**This is the change that makes 20+ categories affordable.** In the first draft, each category
defined its own sections from scratch — 20 categories meant 20 schemas and 20 × N templates. It
doesn't scale, and you'd be maintaining near‑identical "list of things with a price" code five times.

Instead: a small library of **content modules**, and a category is mostly a *manifest* — which modules,
what they're called in this trade, and what the defaults are. A barber's `priceList` and a car wash's
`priceList` are the same data structure with different labels.

A template **may not** invent a field. If a template needs something new, it becomes a field on a
module, and every template rendering that module must handle it or ignore it gracefully. This is what
lets a customer switch templates without losing content.

---

### 5.2 The module library

Ten modules cover essentially every local business. Build these once.

| Module | Shape | Serves |
|---|---|---|
| `menu` | groups → items with price, image, tags | food & drink |
| `priceList` | groups → services with price, duration | services of every kind |
| `showcase` | collections → items with images, display price | anything with products on display |
| `team` | people with photo, role, bio, specialties | anywhere a person is the product |
| `portfolio` | projects / before‑after pairs | anything with visible results |
| `schedule` | recurring weekly timetable | classes, sessions, programmes |
| `listings` | items with structured specs + gallery | property, vehicles |
| `packages` | tiered offers with inclusions | memberships, bundles, event packages |
| `credentials` | licences, certifications, affiliations | regulated trades |
| `coverage` | service areas + response time | anyone who comes to you |

Plus the **universal sections** (§5.3), which every category gets automatically.

**Rough rule:** a category = universal sections + **2 to 4 modules**. If a new category needs a
module that doesn't exist, that's a real product decision — not a quick add.

---

### 5.3 Universal sections (every category, always)

| Section | Fields |
|---|---|
| `brand` | `logo` (image), `name` (text, req), `tagline` (text 80), `favicon` |
| `hero` | `headline` (req, 70), `subheadline` (140), `backgroundImage`, `primaryCta {label, type: call\|whatsapp\|directions\|link\|scroll, href}`, `secondaryCta` |
| `about` | `title`, `body` (richtext), `image`, `highlights` (list max 4: `{icon, label, value}`) |
| `gallery` | `title`, `images` (max 24: `{image, alt, caption}`) |
| `testimonials` | `title`, `items` (max 12: `{author, role, rating 1–5, quote}`) |
| `hours` | `weekhours` (7 × array of `{open, close}` — split shifts matter for prayer‑time closures), `note`, `ramadanNote` |
| `contact` | `phone`, `whatsapp`, `email`, `address`, `geo`, `mapEmbed`, `showContactForm` |
| `social` | `instagram`, `tiktok`, `snapchat`, `x`, `facebook`, `youtube`, `googleMapsUrl` |
| `seo` | `title` (60), `description` (160), `ogImage`, `noindex` |
| `footer` | `note`, `showCredit` (your backlink — leave on for the base tier) |

A site with only universal sections is already sellable to *any* business. Modules are the
differentiator layer, not the minimum viable product.

---

### 5.4 Module field specs

**`menu`**
```
groups (list, max 15)
  name (req) · description · items (list, max 60)
    name (req) · description · priceMinor · image
    tags (multi: spicy, vegan, vegetarian, new, bestseller, gluten-free)
    calories (number) · available (bool)
showPrices (bool) · currencyNote · disclaimer
```

**`priceList`** — the workhorse; used by more categories than anything else
```
groups (list, max 10)
  name (req) · note · items (list, max 40)
    name (req) · description · priceMinor · priceType (fixed | from | range | on_request)
    priceMaxMinor · durationMinutes · image · popular (bool)
showPrices (bool) · vatNote · bookingNote
```

**`showcase`** — replaces the old "catalog"; display only, no commerce
```
collections (list, max 12)
  name (req) · description · coverImage · items (list, max 80)
    name (req) · description · images (gallery, max 6)
    priceMinor · priceNote ("starting from", "call for price")
    attributes (list max 6: {label, value})   // sizes, colors, material, capacity — generic on purpose
    badge (new | featured | limited | none)
    enquireVia (whatsapp | call | visit | link) · enquireHref
```
Note `attributes` is a generic key/value list rather than typed `sizes`/`colors`. That one decision
lets the same module serve clothing, furniture, perfume, jewelry, flowers, and electronics without a
schema change per trade.

**`team`**
```
members (list, max 24)
  name (req) · role · photo · bio (richtext) · specialties (list)
  credentials (list) · languages (multi) · instagram · bookingHref
layout (grid | row) · title · intro
```

**`portfolio`**
```
mode (projects | beforeAfter)
items (list, max 40)
  title · description · images (gallery max 8)
  beforeImage · afterImage        // when mode = beforeAfter
  completedAt · location · tags (list)
```

**`schedule`**
```
sessions (list, max 60)
  name (req) · day (mon..sun) · startTime · endTime
  instructor (ref to team member) · level (beginner|intermediate|advanced|all)
  capacity (number) · room · gender (mixed|men|women)   // relevant in this market
note · timezoneNote · bookingMode (walkin | phone | whatsapp | external) · bookingHref
```

**`listings`**
```
items (list, max 60)
  title (req) · description (richtext) · images (gallery max 12)
  priceMinor · priceNote · status (available | reserved | sold | rented)
  specs (list max 10: {label, value, icon})   // bedrooms/area/year/mileage — generic again
  location · geo · reference
filters (multi: which spec labels are filterable)
```

**`packages`**
```
tiers (list, max 6)
  name (req) · priceMinor · period (once | month | year | session)
  description · inclusions (list max 12) · excluded (list)
  highlighted (bool) · ctaLabel · ctaType (call|whatsapp|link)
note (richtext)
```

**`credentials`**
```
items (list, max 20)
  title (req) · issuer · image · number · validUntil
insurersAccepted (list)      // clinics
licenceNote (richtext)
```

**`coverage`**
```
areas (list, max 40: {name, note})
radiusKm (number) · emergencyAvailable (bool) · responseTimeNote
calloutFeeMinor · calloutFeeNote
```

---

### 5.5 Category catalog

Every category = universal sections + the modules listed. **Nothing below requires a new module.**

#### Food & drink
| Category | Modules | Extra fields |
|---|---|---|
| `restaurant` | menu, portfolio*, packages* | `delivery.providers` (hungerstation/jahez/talabat/keeta/other), `reservations`, `venue.features` (family section, outdoor, parking, drive‑thru, private rooms) |
| `cafe` | menu, showcase*, schedule* | same delivery block; `venue.features` (wifi, study‑friendly, outdoor) |
| `bakery_sweets` | menu, showcase, portfolio | `customOrders.note`, `leadTimeNote` (cakes) |
| `coffee_roastery` | showcase, menu*, portfolio* | `originsList`, `wholesaleContact` |

#### Personal care
| Category | Modules | Extra fields |
|---|---|---|
| `barber` | priceList, team, portfolio | `booking.mode`, `amenities` (kids welcome, VIP room, card accepted, parking) |
| `ladies_salon` | priceList, team, portfolio, packages* | `privacyNote` (women‑only, private rooms), `homeServiceAvailable` |
| `spa_massage` | priceList, packages, team* | `facilities`, `genderDays` |
| `nails_lashes` | priceList, portfolio, team* | `booking.mode` |

#### Retail (showcase only — see §5.0)
| Category | Modules | Notes |
|---|---|---|
| `clothing` | showcase, portfolio* (lookbook) | `sizeGuide` (richtext + table), `brandsCarried` |
| `abaya_traditional` | showcase, portfolio, priceList* | tailoring/alteration priceList is common |
| `perfume_oud` | showcase, packages* | `attributes` carry notes/concentration/size |
| `jewelry_gold` | showcase, credentials* | `pricingNote` (gold price varies daily — important) |
| `furniture_decor` | showcase, portfolio | `deliveryNote`, `assemblyNote` |
| `electronics_mobile` | showcase, priceList | priceList = repair services |
| `flowers_gifts` | showcase, packages | `sameDayDelivery`, `occasions` |
| `pet_shop` | showcase, priceList* | priceList = grooming |
| `bookstore_stationery` | showcase | |

#### Health
| Category | Modules | Extra fields |
|---|---|---|
| `clinic_general` | priceList, team, credentials | `insurersAccepted`, `booking.mode`, `emergencyNote` |
| `dental` | priceList, team, credentials, portfolio | portfolio = before/after |
| `dermatology_cosmetic` | priceList, team, portfolio, packages | |
| `physiotherapy` | priceList, team, schedule* | |
| `vet_clinic` | priceList, team, credentials* | |
| `pharmacy` | showcase*, priceList* | mostly universal sections + hours; `servicesOffered` |
| `optical` | showcase, priceList, team* | |

> **Health categories need a compliance note.** Medical advertising in Saudi is regulated (MOH /
> SFDA rules on health claims, before‑after imagery, and practitioner credentials). Put a
> per‑category `disclaimerText` field, make it required for health categories, and keep the templates
> free of therapeutic claims. Don't let the LLM demo generator write medical copy.

#### Fitness & education
| Category | Modules | Extra fields |
|---|---|---|
| `gym_fitness` | packages, schedule, team, priceList* | `facilities`, `genderPolicy`, `trialOffer` |
| `sports_academy` | schedule, packages, team, portfolio* | `ageGroups` |
| `nursery_kindergarten` | schedule, team, credentials, portfolio | `ageGroups`, `curriculum`, `safetyNote`, `tuitionNote` |
| `training_center` | schedule, packages, team, credentials | `certificatesIssued` |
| `driving_school` | packages, schedule, credentials | |

#### Automotive
| Category | Modules | Extra fields |
|---|---|---|
| `auto_repair` | priceList, portfolio, coverage* | `brandsServiced`, `warrantyNote`, `roadsideAvailable` |
| `car_wash_detailing` | priceList, packages, portfolio | `mobileServiceAvailable` |
| `tinting_wraps` | priceList, portfolio | `warrantyNote` |
| `car_rental` | listings, packages | specs = year/seats/transmission |
| `car_dealership` | listings, credentials* | specs = year/mileage/spec/warranty |

#### Home & professional services
| Category | Modules | Extra fields |
|---|---|---|
| `contractor_maintenance` | priceList, portfolio, coverage | `tradesCovered`, `emergency24h` |
| `ac_plumbing_electrical` | priceList, coverage, portfolio* | `calloutFee`, `emergency24h` |
| `cleaning_services` | packages, coverage, priceList* | `staffGenderAvailable` |
| `interior_design` | portfolio, team, packages* | `stylesList`, `processSteps` |
| `moving_storage` | priceList, coverage, packages* | `quoteRequestNote` |
| `laundry_drycleaning` | priceList, coverage* | `pickupDelivery`, `turnaroundTime` |

#### Professional & events
| Category | Modules | Extra fields |
|---|---|---|
| `real_estate_office` | listings, team, credentials* | specs = bedrooms/area/floor/finishing |
| `law_firm` | team, credentials, priceList* | `practiceAreas`, `consultationNote` |
| `accounting_consulting` | team, credentials, packages | `servicesList`, `zatcaSupport` |
| `photography_studio` | portfolio, packages, team* | `equipmentNote`, `turnaroundTime` |
| `event_planning` | portfolio, packages, showcase* | `eventTypes`, `capacityRange` |
| `wedding_hall` | portfolio, packages, showcase* | `capacity`, `cateringIncluded`, `genderSections` |
| `travel_agency` | showcase, packages, credentials* | showcase items = trips/destinations |
| `marketing_agency` | portfolio, packages, team | |

\* = optional module, off by default, toggleable per site.

**That's ~45 categories from 10 modules.** Adding `bookstore` or `optical` costs you a manifest entry
and some Arabic labels — under an hour, no deploy if the registry is in the DB.

---

### 5.6 Templates are built per *archetype*, not per category

This is the second multiplier. A template's job is to render modules. If a template renders
`priceList + team + portfolio`, it works for barber, ladies salon, dental, auto repair, and cleaning —
with different labels, imagery, and palette.

| Archetype | Primary modules | Categories served |
|---|---|---|
| **A. Menu‑led** | menu | restaurant, cafe, bakery, roastery |
| **B. Service‑led** | priceList + team | barber, salon, spa, clinic, auto repair, laundry, contractor |
| **C. Product‑led** | showcase | all retail, travel, flowers |
| **D. Work‑led** | portfolio + packages | photography, interior design, events, wraps |
| **E. Schedule‑led** | schedule + packages + team | gym, nursery, academy, training centre |
| **F. Listing‑led** | listings | real estate, car rental, dealership |

**Template count:** 3 templates per archetype = **18 templates covering ~45 categories**, versus 225
under the naive per‑category model. Each template declares `supportedModules`, and the registry only
offers a customer the templates that cover their category's required modules.

A category can still express personality without a bespoke template, via:
`defaultPaletteKeys` · `defaultTemplateKey` · hero imagery pool · module ordering ·
label overrides (`priceList` renders as "Services", "Treatments", or "Wash packages").

---

### 5.7 Launch order

Don't ship 45 categories. Ship **archetype B first** — it's the largest cluster, the easiest content
to collect (a price list is a photo of a wall sign), and the businesses are the most likely to have no
website at all.

| Wave | Archetypes | Categories | Templates |
|---|---|---|---|
| **1** | B, A | barber, ladies_salon, restaurant, cafe | 4 (2 per archetype) |
| **2** | C | clothing, abaya, perfume, flowers, furniture | +3 |
| **3** | B extended | auto_repair, car_wash, laundry, cleaning, contractor | +0 (reuse B) |
| **4** | E, D | gym, nursery, photography, interior_design | +4 |
| **5** | F | real_estate, car_rental | +2 |

Waves 3 costs almost nothing — that's the payoff of the archetype design, and it's the point at which
this stops being a website builder and starts being a system.

---

### 5.8 Data model impact

Two changes to §4:

```js
// new collection: modules — the reusable field definitions
{ _id, key: 'priceList', name: {en, ar}, schemaVersion: Number,
  fields: [ FieldDef ], status: 'ACTIVE'|'DEPRECATED' }

// categories — now a manifest rather than a full schema
{ _id, key: 'barber', name: {en, ar}, archetype: 'B',
  modules: [
    { moduleKey: 'priceList', required: true,  order: 1,
      labelOverride: { en: 'Services', ar: 'الخدمات' } },
    { moduleKey: 'team',      required: false, order: 2 },
    { moduleKey: 'portfolio', required: false, order: 3,
      config: { mode: 'beforeAfter' } }
  ],
  extraFields: [ FieldDef ],      // the small category-specific bits from §5.5
  defaultTemplateKey, defaultPaletteKeys, schemaVersion, status, sortOrder }

// templates
{ ..., archetype: 'B', supportedModules: ['priceList','team','portfolio','packages'] }
```

Validation rule at publish: `category.modules.filter(required).map(moduleKey)` must be a subset of
`template.supportedModules`. Enforce it in CI too, across every category × template pair — that test
is what stops a category addition from silently breaking a template six months later.

### 5.9 Palettes

Ship **8 fixed palettes**, each 7 tokens. Custom colors are a Pro feature — customers pick bad colors
and then blame the product.

```css
:root{
  --c-primary:#8B5E34; --c-secondary:#2E2A27; --c-accent:#D9A441;
  --c-bg:#FBF8F4; --c-surface:#FFFFFF; --c-text:#1C1917; --c-muted:#78716C;
}
```
Templates reference **only** these variables — never hard‑coded hex. Validate every palette for WCAG
AA contrast at build time; a palette that fails contrast never ships.

### 5.10 Arabic / RTL — not optional in this market

- Store `locale` and `direction` per site; render `<html dir="rtl" lang="ar">`.
- Use **logical CSS properties** everywhere (`margin-inline-start`, not `margin-left`). Retrofitting
  this later is a rewrite of every template — do it from the first line of CSS.
- Self‑host a subset Arabic font (IBM Plex Sans Arabic / Noto Kufi Arabic).
- Every module and category label is bilingual (`{ en, ar }` — already in the schema), including
  `labelOverride`.
- Arabic‑Indic vs Latin numerals as a per‑site setting; prices are where it shows.

### 5.11 Editor UX (admin side)

```
1. Category   (locked after first publish — changing it changes the modules)
2. Template   (switchable anytime; only compatible templates are offered)
3. Palette    (live preview)
4. Content    (accordion — universal sections, then the category's modules in order)
5. Preview    (iframe of the draft at /preview/<token>, desktop/mobile toggle)
6. Publish
```

- The form is **generated** from the module definitions. One `<SchemaField>` component with a switch
  on `type`. New category = zero frontend work; new module = one afternoon.
- **Tiptap** only for `richtext` fields. Toolbar restricted to bold/italic/link/lists/headings.
  **Store `getJSON()`, never `getHTML()`.**
- Autosave on a 2s debounce → `PATCH /sites/:id/draft`. Publishing stays a deliberate act.
- Every image field crops to aspect before upload — otherwise you will receive vertical phone photos
  every single time and the templates will break.
- Optional modules appear as toggles ("Add a team section"), off by default. **Empty sections must
  never render** — a barber with no team photos should get a site with no team section, not an empty
  grey block.

---

## 6. Authentication & security

### 6.1 Token strategy

| Token | Lifetime | Storage | Notes |
|---|---|---|---|
| **Access JWT** | 15 min | httpOnly cookie `__Host-at` | Claims: `sub`, `role`, `bid`, `pwdAt`, `jti` |
| **Refresh token** | 30 days | httpOnly cookie `__Host-rt`, `path=/auth` | Opaque 32‑byte random; **only the SHA‑256 hash** is in Mongo |
| **Invite / reset** | 72 h / 30 min | Emailed link, single use | Hash stored, token never persisted |

Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/`. **Do not set a `Domain` attribute** — host‑only
cookies are the point (§2). The `__Host-` prefix enforces this at the browser level.

Why cookies over `localStorage`: `localStorage` is readable by any script on the page. Given your
product involves rendering customer‑supplied content, that's an unacceptable class of risk.

### 6.2 Refresh rotation with reuse detection

Every refresh issues a new token and revokes the old one, within a `familyId`. If a **revoked** token
is ever presented, the entire family is revoked and the user is forced to re‑login — that's your
signal that a token was stolen.

```ts
async refresh(raw: string, ctx: ReqCtx) {
  const hash = sha256(raw);
  const rec  = await this.tokens.findOne({ tokenHash: hash });

  if (!rec) throw new UnauthorizedException();

  if (rec.revokedAt) {                                  // replay → breach
    await this.tokens.updateMany(
      { familyId: rec.familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    await this.audit.log('auth.refresh_reuse', rec.userId, ctx);
    throw new UnauthorizedException('Session revoked');
  }
  if (rec.expiresAt < new Date()) throw new UnauthorizedException();

  const next = await this.issue(rec.userId, rec.familyId, ctx);
  await this.tokens.updateOne(
    { _id: rec._id },
    { $set: { revokedAt: new Date(), replacedBy: next._id } },
  );
  return next;
}
```

### 6.3 Passwords
- **argon2id** (`memoryCost 19456 KiB, timeCost 2, parallelism 1` — OWASP baseline). bcrypt cost 12
  is an acceptable fallback.
- Minimum 10 characters, checked against a breached‑password list (k‑anonymity range query against
  HIBP, or a bundled top‑10k list offline).
- Timing‑safe: always run a dummy hash comparison when the email doesn't exist, so response time
  doesn't leak account existence.
- Login errors are always the same generic string, whatever went wrong.

### 6.4 Rate limiting & lockout
| Route | Limit |
|---|---|
| `POST /auth/login` | 5 / 15 min per IP **and** per email |
| `POST /auth/forgot-password` | 3 / hour per email |
| `POST /public/sites/:id/contact` | 3 / hour per IP + honeypot + Turnstile |
| Authenticated API | 120 / min per user |
| Media presign | 30 / hour per business |

Lockout: exponential backoff after 5 failures (`lockedUntil`), capped at 30 min. Never permanent —
permanent lockout is a denial‑of‑service vector against your own customers.

### 6.5 Authorization

Two guards, composed, applied globally:

```ts
@Injectable()
export class BusinessScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const { role, bid } = req.user;
    const target = req.params.businessId ?? req.body?.businessId;

    if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
    if (!target || String(target) !== String(bid)) throw new ForbiddenException();
    return true;
  }
}
```

**Defense in depth:** the guard is not enough. Every repository method takes `businessId` as a
mandatory argument and injects it into the Mongo filter. A missing guard then still can't leak data
across tenants. Write one integration test per owner endpoint that asserts a 403/404 when called with
another business's id — this is the test suite that matters most.

### 6.6 Admin hardening
- **TOTP 2FA mandatory** for `ADMIN` / `SUPER_ADMIN`. Non‑negotiable: these accounts can edit every
  customer site.
- **Impersonation** (support tool) issues a short 10‑minute token with `act: adminUserId`, is
  **read‑only by default**, writes an audit entry on entry and exit, and shows a persistent banner in
  the UI.
- Consider IP allowlisting `/admin/*` once you have a fixed office/VPN.

### 6.7 XSS — the risk specific to this product

You are letting customers author content that you then serve on domains you control. Treat every
piece of customer content as hostile.

1. **Store Tiptap JSON, render server‑side.** Never `dangerouslySetInnerHTML` with stored HTML.
2. If you must accept HTML, sanitize **server‑side on write** with `sanitize-html` against a strict
   allowlist (`p, strong, em, u, a, ul, ol, li, h2, h3, br`), and again on read. Client‑side
   sanitization alone is decorative.
3. Links: force `rel="noopener noreferrer nofollow"`, allow only `https:`, `mailto:`, `tel:`.
   Explicitly reject `javascript:` and `data:` — this is the payload people actually try.
4. **CSP on the renderer** with no `unsafe-inline` (use nonces):
   ```
   default-src 'self'; img-src 'self' https://cdn.sitely.com data:;
   script-src 'self' 'nonce-{random}'; style-src 'self' 'nonce-{random}';
   frame-ancestors 'none'; base-uri 'none'; object-src 'none'
   ```
5. SVG uploads: **reject them.** SVG is a script execution vector. Accept JPEG/PNG/WebP/AVIF only,
   and re‑encode every upload through `sharp` — which strips any embedded payload and EXIF GPS data.

### 6.8 NoSQL injection
- `class-validator` + `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`
  globally. Anything not on a DTO never reaches a query.
- `express-mongo-sanitize` to strip `$`/`.` keys from input.
- Ban `$where`, `$function`, and `mapReduce` in code review.
- Cast every id with `new Types.ObjectId(...)` inside a try/catch → 400, never pass raw strings.

### 6.9 Uploads
Presigned PUT, but validate hard:
- Presign requires auth, checks quota, and pins `Content-Type` + `Content-Length` in the policy.
- Max 8 MB. Verify **magic bytes** server‑side after upload, not the declared MIME.
- Re‑encode to WebP + generate variants in a background job; only then flip `status: 'READY'`.
- Serve from a **separate cookieless domain** (`cdn.…`) with `Content-Disposition: attachment` for
  anything unexpected.

### 6.10 Other essentials
`helmet()` · CORS allowlist (exact origins, `credentials: true`, no wildcard) · CSRF double‑submit
token on state‑changing routes since you're cookie‑based · webhook raw‑body signature verification
with constant‑time compare · secrets in a manager, never in `NEXT_PUBLIC_*` · dependency scanning in
CI · structured logs with **PII redaction** (never log tokens, passwords, or full phone numbers) ·
Mongo Atlas IP allowlist + least‑privilege DB user · daily automated backups with a **restore drill
you have actually performed**.

---

## 7. API surface (NestJS)

Base: `https://api.sitely.com/v1` · JSON · errors as RFC 7807 problem details.

### 7.1 Auth — `/auth`
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/login` | public | Email + password (+ TOTP for admins) → sets cookies |
| POST | `/auth/refresh` | cookie | Rotate tokens |
| POST | `/auth/logout` | auth | Revoke current token |
| POST | `/auth/logout-all` | auth | Revoke whole family |
| GET | `/auth/me` | auth | Current user + business summary |
| POST | `/auth/invite/verify` | public | Validate invite token (pre‑fill screen) |
| POST | `/auth/invite/accept` | public | Set first password → ACTIVE |
| POST | `/auth/forgot-password` | public | Always 202, regardless of existence |
| POST | `/auth/reset-password` | public | Consume token, set password, revoke all sessions |
| POST | `/auth/change-password` | auth | Requires current password |
| POST | `/auth/2fa/setup` · `/verify` · `/disable` | admin | TOTP lifecycle |

### 7.2 Admin — `/admin` (role: ADMIN)
| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/metrics` | MRR, active/churned, sites published, funnel |
| POST | `/admin/businesses` | **Create business + owner user + send invite** (single transaction) |
| GET | `/admin/businesses` | List, filter by status/category, paginated |
| GET | `/admin/businesses/:id` | Full detail |
| PATCH | `/admin/businesses/:id` | Update core fields |
| POST | `/admin/businesses/:id/suspend` · `/reactivate` | Lifecycle |
| DELETE | `/admin/businesses/:id` | Soft delete + 30‑day purge job |
| POST | `/admin/businesses/:id/impersonate` | Scoped support token (audited) |
| POST | `/admin/businesses/:id/resend-invite` | |
| GET/POST/PATCH | `/admin/categories[/:key]` | Schema registry CRUD |
| POST | `/admin/categories/:key/publish` | Bump `schemaVersion`, run migration job |
| GET/POST/PATCH | `/admin/templates[/:key]` | Template registry |
| GET | `/admin/leads` | Pipeline board |
| POST | `/admin/leads/import` | CSV / Places import job |
| PATCH | `/admin/leads/:id` | Status, notes |
| POST | `/admin/leads/:id/build-demo` | **Generate a demo site from lead data** |
| GET | `/admin/audit-logs` | |

### 7.3 Owner — `/me`, `/sites`, `/media`
| Method | Path | Purpose |
|---|---|---|
| GET | `/me/business` | Business + subscription + site state |
| PATCH | `/me/business` | Contact info, locale |
| GET | `/catalog/categories/:key` | The schema that drives the editor form |
| GET | `/catalog/templates?category=` | Available templates + thumbnails |
| GET | `/catalog/palettes` | |
| GET | `/sites/:businessId/draft` | Draft content |
| PATCH | `/sites/:businessId/draft` | **Partial section update** — autosave target |
| PUT | `/sites/:businessId/template` | Switch template (validates section coverage) |
| PUT | `/sites/:businessId/palette` | |
| POST | `/sites/:businessId/validate` | Dry‑run validation, returns field‑level errors |
| POST | `/sites/:businessId/publish` | Snapshot → live + cache purge |
| GET | `/sites/:businessId/versions` | History |
| POST | `/sites/:businessId/versions/:v/restore` | Rollback |
| GET | `/sites/:businessId/preview-token` | Signed short‑lived preview URL |
| POST | `/media/presign` | → `{ uploadUrl, mediaId, fields }` |
| POST | `/media/:id/complete` | Trigger processing |
| GET | `/media` · DELETE `/media/:id` | Library |
| GET | `/sites/:businessId/stats?range=30d` | Pageviews, calls, WhatsApp clicks |
| GET | `/sites/:businessId/submissions` | Contact form inbox |

### 7.4 Domains — `/domains`
| Method | Path | Purpose |
|---|---|---|
| POST | `/domains/:businessId/subdomain/check` | Availability + reserved‑word check |
| PUT | `/domains/:businessId/subdomain` | Change (limit: once per 30 days) |
| POST | `/domains/:businessId/custom` | Attach custom domain → returns DNS records to set |
| POST | `/domains/:businessId/custom/verify` | Poll TXT/CNAME, trigger cert issuance |
| DELETE | `/domains/:businessId/custom` | |

### 7.5 Billing — `/billing`
| Method | Path | Purpose |
|---|---|---|
| GET | `/billing/plans` | Public pricing (SAR, VAT‑inclusive display) |
| POST | `/billing/checkout` | Create hosted checkout/subscription session |
| GET | `/billing/subscription` | Current state |
| POST | `/billing/portal` | Hosted management link (if provider supports) |
| POST | `/billing/cancel` | `cancelAtPeriodEnd = true` |
| POST | `/billing/addons/custom-domain` | |
| GET | `/billing/invoices` · `/invoices/:id/pdf` | ZATCA‑compliant |
| POST | `/webhooks/:provider` | **Raw body**, signature verified, idempotent |

### 7.6 Public (consumed by the renderer, no auth)
| Method | Path | Purpose |
|---|---|---|
| GET | `/public/resolve?host=` | Host → published site JSON. **Cache aggressively.** |
| GET | `/public/sites/:id/sitemap` | |
| POST | `/public/sites/:id/contact` | Rate‑limited, honeypot, Turnstile |
| POST | `/public/sites/:id/events` | Analytics beacon, fire‑and‑forget |

### 7.7 Conventions
- Cursor pagination (`?cursor=&limit=`) — skip/limit degrades badly on lead lists.
- `PATCH` bodies are JSON Merge Patch semantics on `content.<section>`.
- `If-Match` / `version` on draft updates → 409 on concurrent edit conflict.
- `Idempotency-Key` header required on `POST /billing/checkout` and `/admin/businesses`.
- Every response carries `x-request-id`; log it everywhere.

---

## 8. Core flows

### 8.1 Onboarding (your no‑signup model)

```
Admin fills "New business" form
   ├─ create businesses doc          (status: AWAITING_PAYMENT)
   ├─ create users doc               (role: OWNER, status: INVITED)
   ├─ create sites doc × 2           (DRAFT seeded from category defaults + lead data)
   ├─ reserve subdomain
   └─ email invite link              (72h, single use)
                    │
Owner clicks link → sets password → lands on paywall
                    │
Owner pays → webhook → subscription ACTIVE → business ACTIVE
                    │
Editor unlocks → category → template → palette → content → publish
```

**One thing to reconsider:** paying *before* seeing the editor is a hard ask from a barber who has
never bought software. Two alternatives worth testing:
- **Preview‑then‑pay:** editor is fully open, but **Publish** is the paywall. Much higher conversion,
  and it makes the demo do the selling.
- **Trial with card:** 14 days, card captured upfront. Better for churn; worse for signups.

I'd ship preview‑then‑pay. The friction you want to remove is exactly the friction of "I can't see
what I'm buying."

### 8.2 Publish

```ts
async publish(businessId: string, userId: string) {
  const session = await this.conn.startSession();
  return session.withTransaction(async () => {
    const draft = await this.sites.findOne({ businessId, state: 'DRAFT' }).session(session);
    const category = await this.categories.findOne({ key: draft.categoryKey });

    // 1. validate against the category schema (AJV/Zod compiled from the registry)
    const errors = validateAgainstSchema(draft.content, category);
    if (errors.length) throw new UnprocessableEntityException({ errors });

    // 2. verify the template can render every populated section
    const tpl = await this.templates.findOne({ key: draft.templateKey });
    assertSectionsCovered(draft.content, tpl.supportedSections);

    // 3. archive the current live version
    const live = await this.sites.findOne({ businessId, state: 'PUBLISHED' }).session(session);
    if (live) await this.versions.create([toSnapshot(live)], { session });

    // 4. snapshot draft → published
    const published = await this.sites.findOneAndUpdate(
      { businessId, state: 'PUBLISHED' },
      { $set: { ...pick(draft), publishedFrom: draft._id }, $inc: { version: 1 } },
      { upsert: true, new: true, session },
    );

    await this.businesses.updateOne(
      { _id: businessId },
      { $set: { publishedSiteId: published._id, publishedAt: new Date() } },
      { session },
    );

    // 5. AFTER commit: invalidate. Never inside the transaction.
    this.events.emit('site.published', { businessId, siteId: published._id });
    return published;
  });
}
```

The `site.published` handler: `DEL site:<host>` in Redis → call the renderer's revalidate hook
(`POST /api/revalidate` with a shared secret) → purge CDN by tag → warm the cache with one fetch.
Target: **live within 5 seconds.**

### 8.3 Payment failure ladder
```
day 0   payment fails → status PAST_DUE, email + WhatsApp
day 1,3,5  provider retries
day 7   grace ends → site serves a "temporarily unavailable" page (NOT a 404 — preserves SEO,
        and a live 404 is what makes people rage‑cancel)
day 30  status CANCELED, site unpublished, data retained 90 days
day 120 hard delete
```

### 8.4 Demo generation (your growth engine)

`POST /admin/leads/:id/build-demo` should take **under 60 seconds of your time**:
1. Map lead's Google category → your `categoryKey`.
2. Pick the default template + a palette seeded from the category.
3. Seed `content` from lead facts: name, phone, address, geo, hours.
4. Fill imagery from a **curated per‑category stock pool** (licensed, not scraped).
5. Generate copy — headline, about, service names — with an LLM call, in Arabic and English.
6. Publish to `<slug>-demo.sitelypages.com` with `isDemo: true`, `noindex`, a demo banner, and
   `demoExpiresAt: +30d`.

Queue this as a BullMQ job. Your job is then only to walk in and show a phone screen.

---

## 9. Rendering & performance

- **ISR everywhere.** `export const revalidate = false` + on‑demand `revalidateTag('site:<id>')`.
  Pages are static; a publish invalidates exactly one tag. Cost per site approaches zero.
- **Two fetches max** per cold render: `resolve(host)` → site JSON. Cache it in Redis with a 1‑hour
  TTL and an explicit purge on publish.
- Fonts self‑hosted, subset, `font-display: swap`.
- Images through `next/image` with the CDN loader; `sizes` set correctly; blurhash placeholder.
- **JSON‑LD `LocalBusiness`** on every site (`name`, `address`, `geo`, `telephone`, `openingHours`,
  `priceRange`, `sameAs`, plus `Restaurant`/`HairSalon`/`ClothingStore` subtypes with `hasMenu` where
  applicable). **This is the actual product value** — it's what gets them into Google's local results.
  Sell the SEO, not the website.
- Per‑site `robots.txt` + `sitemap.xml`; `noindex` for demos and suspended sites.
- Budget: **LCP < 2.0s on 4G, total JS < 90KB** per template. Enforce in CI with Lighthouse.
- These businesses' customers are 90%+ mobile. Design mobile‑first and test on a real mid‑range
  Android, not a MacBook viewport.

---

## 10. Infrastructure & cost

| Concern | v1 choice | Approx. monthly |
|---|---|---|
| API hosting | Railway / Render / Hetzner VPS (Nest + BullMQ workers) | $10–25 |
| Frontends | Vercel Hobby → Pro when needed | $0 → $20 |
| Database | MongoDB Atlas M0 → M10 | $0 → ~$60 |
| Redis | Upstash free tier | $0 |
| Object storage + CDN | **Cloudflare R2** (zero egress fees) | ~$5 |
| Email | Resend / AWS SES | $0–20 |
| Domains | 2 domains | ~$2 |
| Custom hostnames (later) | Cloudflare SSL for SaaS | ~$5+ |
| Error tracking | Sentry free | $0 |
| **Total (pre‑revenue)** | | **≈ $20–40** |
| **Total (~100 customers)** | | **≈ $120–180** vs ~$2,000 revenue |

**Cloudflare R2 over S3 specifically because of zero egress** — you're serving images to the public
all day. On S3, bandwidth becomes your largest line item surprisingly fast.

Environments: `local` (docker‑compose: mongo + redis + minio) → `staging` (full clone, seeded) →
`production`. Never test a schema migration anywhere but staging.

---

## 11. Repository layout

```
sitely/
├─ apps/
│  ├─ api/                 # NestJS
│  │  └─ src/modules/{auth,users,businesses,sites,categories,templates,
│  │                    media,billing,domains,leads,analytics,webhooks,jobs}
│  ├─ panel/               # Next.js — app.sitely.com
│  └─ renderer/            # Next.js — *.sitelypages.com
├─ packages/
│  ├─ schema/              # category definitions + Zod validators (SHARED — single source of truth)
│  ├─ templates/           # React template components, one folder each
│  ├─ ui/                  # shared primitives
│  ├─ types/               # generated from schema registry
│  └─ config/              # eslint, tsconfig, tailwind preset, palettes
└─ docker-compose.yml
```
pnpm workspaces + Turborepo. **`packages/schema` being shared by all three apps is what keeps the
category contract honest** — the API validates with it, the panel builds forms from it, the templates
type against it.

---

## 12. Build order

| Phase | Weeks | Deliverable | Done when |
|---|---|---|---|
| **0 — Foundation** | 1 | Monorepo, docker‑compose, Nest skeleton, Mongo connection, CI | `pnpm dev` runs all three apps |
| **1 — Auth** | 1–2 | Login, invite/accept, refresh rotation, guards, RBAC, audit log | Cross‑tenant access tests pass |
| **2 — Schema engine** | 1–2 | Category registry, Zod generation, `<SchemaField>` form renderer | A new category needs zero frontend code |
| **3 — Renderer** | 2 | Host middleware, `/_sites/[key]`, ISR, 1 template end‑to‑end | A hand‑seeded site is live on a subdomain |
| **4 — Editor** | 2–3 | Wizard, Tiptap, media upload, autosave, preview, publish | You can build a site in <20 min without touching the DB |
| **5 — Templates** | 2–3 | Wave‑1 templates (archetypes A+B), 8 palettes, RTL, Lighthouse gates | Every template renders every golden fixture for its archetype |
| **6 — Billing** | 1–2 | Gateway integration, webhooks, dunning, invoices | A real card completes a real subscription |
| **7 — Leads + demos** | 1–2 | Lead pipeline, `build-demo` job, outreach tracking | A demo generates in <60s |
| **8 — Analytics** | 1 | Event beacon, daily rollup, monthly "your site got X calls" email | First retention email sends |
| **9 — Custom domains** | 1–2 | Verification, cert automation | *Only after 20 paying customers* |

**Realistic solo timeline: 4–6 months to a sellable v1.** If that feels long, cut to 2 categories ×
1 template and skip phases 7–9 — you can sell 10 customers by hand while the automation is being
built, and those 10 will tell you what to build next.

**Phase 2 (the module/schema engine) is the load‑bearing phase.** Get it right and categories 5
through 45 are configuration. Rush it and you'll be writing bespoke code per category forever — which
is exactly the outcome this whole design exists to prevent.

---

## 13. Decisions to make before writing code

1. **Pay‑to‑edit vs pay‑to‑publish?** (I recommend pay‑to‑publish.)
2. **Which gateway?** Ask each one: *do you support recurring tokenized billing on Mada?* That answer
   picks your gateway.
3. **Monthly only, or monthly + annual prepay?** (Ship annual. It fixes churn.)
4. **Category schema in a DB registry vs in code?** (Registry + generated types, per §4.3/§5.8.)
4b. **Which wave‑1 categories?** Pick by what you can physically walk into in your own neighbourhood
   this week — not by market size. Proximity beats TAM when you're doing the selling yourself.
5. **Arabic‑first, English‑first, or bilingual sites?** Affects every template's layout. Decide now.
6. **Who owns the content if they cancel?** Write it into the terms. Offer a static export as a
   goodwill feature — it costs you nothing and removes "I'm locked in" as an objection.
7. **What is the actual pitch?** "A website for SAR 79/mo" is weak. "Show up on Google Maps with a
   real site, menu, and one‑tap calling — SAR 79/mo, live tomorrow" is a product.

---

## 14. The three things most likely to kill this

1. **Template maintenance sprawl.** Every template is permanent surface area. Adding a *category*
   should be free; adding a *template* never is. Push variation into palettes, imagery, and label
   overrides before you reach for a new template — and resist building templates as a way of
   avoiding sales calls.
2. **Support load from non‑technical customers.** A barber who can't upload a logo will call you.
   Budget for it: build a 90‑second onboarding video per category, and make the editor so constrained
   that it's hard to produce something ugly.
3. **Churn at month 3.** The site gets built, they never log in again, the card fails, they don't
   care. **Defense: the monthly stats email (§4.14).** Proof of calls received is the difference
   between a subscription and a one‑time sale.

---

*Nothing here is fixed. Change anything that doesn't fit — but change §2's domain isolation rule and
§6.7's "store JSON, not HTML" rule only with a very good reason.*
