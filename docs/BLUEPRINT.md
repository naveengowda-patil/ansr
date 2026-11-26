# Product Catalogue — Blueprint

| | |
|---|---|
| Status | v0.12, backend implemented |
| Last updated | 2026-11-25 |
| Rules | [`CLAUDE.md`](../CLAUDE.md) (how to write code) |
| Decisions log | [`DECISIONS.md`](../DECISIONS.md) (why) |

This is the single source of truth for **what** to build. Every change starts here: update the relevant section (and the changelog at the bottom), then write code to match. Section numbers are stable so commits, PRs and tests can cite them (e.g. "§6.4").

---

## 1. Goal and scope

**Goal.** A proof of concept for a product catalogue app that is also the base the real product grows from. Three things are expected to change later and each sits behind an explicit boundary:

| Will change | Boundary |
|---|---|
| Product data source (Fake Store today) | `ProductRepository` (+ `ProductSearchEngine` for search) on the backend |
| Email provider (Mailpit/SMTP today) | `EmailService` on the backend |
| Look and feel | `AppTheme` tokens on iOS |

**In scope:** the five acceptance criteria in §2, local run via Docker Compose + iOS Simulator, tests for the critical path.

**Out of scope (for now):** authentication, cart/checkout, persistence/database, search sort/filter UI, search pagination UI, rate limiting, analytics, localisation, iPad-specific layouts, deployment pipelines.

## 2. Acceptance criteria

| ID | Criterion | Exact rule |
|---|---|---|
| AC-1 | **Home** shows 5 featured "top rated" products the business picked | Ordered list `FEATURED_PRODUCT_IDS` from config. Ids that don't exist are skipped. If fewer than 5 remain, fill up with the highest-rated products not already included (ranking §5.5). Max 5 products. |
| AC-2 | **Categories**: open a category, see its top rated products first, then the rest | Category names match case-insensitively (§6.8). Top rated = the 3 highest-rated products in that category (§5.5). Rest = the remaining products of the category in upstream order. No duplicates. A category with ≤3 products has an empty `rest`. |
| AC-3 | **Search**: type a term, tap search, only see matching products | Runs on explicit submit only. Case-insensitive substring match of the trimmed term on title, description **or** category. Filtering happens in the backend. |
| AC-4 | **Product details**: tap a tile to see details | Detail screen fetches the product by id. |
| AC-5 | **Enquiry**: tap "Enquire", fill a short form, submit; sales inbox gets an email, customer sees "Thank you" | Fields `productId`, `name`, `email` required, `message` optional. Plain-text email to `SALES_INBOX_EMAIL` with `Reply-To` = customer. On success the sheet shows a thank-you state. |

## 3. Constraints

- **Under 10 minutes to run locally** for someone new: backend with `docker compose up`, app on the iOS Simulator against the local backend (§8).
- **No paid services or accounts.** Emails are caught locally by Mailpit.
- **No secrets in the repo.** Config via `.env.example` → `.env` (git-ignored).
- **AWS friendly** infra: containerised, stateless, config from env, logs to stdout, health endpoint (§8.3).
- **The iOS app only talks to our backend.** It never calls `fakestoreapi.com`, not even for images.
- **Tests cover the critical path** (§9) so the code can be changed with confidence.

## 4. Architecture overview

```
 iOS app (SwiftUI, MVVM-C)                         Backend (Node.js, Express, TypeScript)              External
┌──────────────────────────────┐                ┌──────────────────────────────────────────┐
│ View → ViewModel → Service   │   HTTP/JSON    │ routes → ports (interfaces) ← adapters   │
│        protocol → NetworkClient├──────────────▶│   │         ProductRepository ──────────┼──▶ fakestoreapi.com
│ AppCoordinator (navigation)  │  (+ images)    │   │         ProductSearchEngine (memory) │
│ AppDependencies (comp. root) │                │   │         EmailService ───────────────┼──▶ SMTP (Mailpit / SES later)
└──────────────────────────────┘                │   └─▶ domain/ (pure business rules)      │
                                                │ container.ts (composition root)           │
                                                └──────────────────────────────────────────┘
```

Repository layout:

```
/
├── CLAUDE.md  DECISIONS.md  AI_USAGE.md  README.md
├── .env.example  .gitignore  docker-compose.yml
├── docs/BLUEPRINT.md
├── backend/          # Node.js + TypeScript API
└── ios/              # SwiftUI app (Xcode project)
```

---

## 5. Backend

### 5.1 Stack and dependencies

Why this stack: D-025.

| Item | Choice | Reason |
|---|---|---|
| Runtime | Node.js 24 LTS (`.nvmrc`, Docker base image) | Current LTS; built-in `fetch` + `AbortSignal.timeout`. |
| Language | TypeScript, `"strict": true` | Required by rules. |
| `express` (v5) | HTTP framework | Required stack; v5 forwards rejected async handlers to the error middleware. |
| `zod` | Request + upstream response validation | Strict schemas (`.strict()` rejects unknown fields) and typed parsing in one place. |
| `nodemailer` | SMTP client for `SmtpEmailService` | De-facto SMTP client; works with Mailpit now and Amazon SES SMTP later. |
| Dev: `typescript`, `tsx`, `vitest`, `supertest`, `@types/*` | Build, dev run, tests | `supertest` drives the app without a network port. |

No other runtime dependencies. Logging uses a small injected `Logger` interface writing JSON lines to stdout (no library).

### 5.2 Structure

```
backend/
├── src/
│   ├── server.ts            # entry point: load config, build container, startServer, graceful shutdown
│   ├── startup.ts           # startServer (listen, then non-blocking catalogue warm-up) and warmCatalogue
│   ├── app.ts               # createApp(deps): Express app, no network port
│   ├── config.ts            # the ONLY place that reads process.env; validates and fails fast
│   ├── container.ts         # composition root: the ONLY place that instantiates adapters
│   ├── errors.ts            # AppError subclasses: ValidationError, NotFoundError, UpstreamError (shared by routes and adapters)
│   ├── ports/               # interfaces routes depend on
│   │   ├── ProductRepository.ts
│   │   ├── ProductSearchEngine.ts
│   │   ├── EmailService.ts
│   │   ├── Logger.ts
│   │   └── Clock.ts             # type Clock = () => number (ms); durations and cache ages
│   ├── domain/              # pure business rules, no I/O
│   │   ├── product.ts           # Product, Rating types
│   │   ├── email.ts             # EmailMessage type (provider-agnostic)
│   │   ├── ranking.ts           # compareByRating (tie-break)
│   │   ├── featured.ts          # selectFeatured
│   │   ├── categoryRanking.ts   # splitTopRated
│   │   ├── search.ts            # SearchQuery types, findUnsupported, matchesText, filter + sort rules
│   │   └── enquiry.ts           # buildEnquiryEmail
│   ├── routes/              # one file per resource; depend on ports + domain only
│   │   ├── health.ts  products.ts  categories.ts  enquiries.ts
│   ├── http/
│   │   ├── errorHandler.ts      # the single error middleware (§5.9)
│   │   ├── params.ts            # shared zod schemas for path/query params
│   │   └── validate.ts          # zod parse helpers → ValidationError (rejects repeated query params)
│   ├── adapters/
│   │   ├── fakestore/           # FakeStoreProductRepository + upstream zod schemas
│   │   ├── search/              # InMemorySearchEngine
│   │   ├── email/               # SmtpEmailService (nodemailer)
│   │   └── logging/             # JsonLogger
│   └── lib/
│       └── TtlCache.ts          # TTL cache: single-flight refetch, stale fallback on error, injected clock
├── test/
│   ├── fixtures/fakestore/      # products.json, recorded from GET /products (image tests use inline bytes)
│   ├── support/                 # fakes.ts (in-memory port fakes, buildProduct) + testApp.ts (createApp wired with fakes)
│   └── *.test.ts
├── Dockerfile  package.json  tsconfig.json  .nvmrc
```

### 5.3 Boundary rules

- Route handlers depend only on `ProductRepository`, `ProductSearchEngine` and `EmailService` (plus `Logger`). They never import anything from `adapters/`, `nodemailer` or Fake Store code.
- Adapters are created only in `src/container.ts`. Nothing else uses `new` on an adapter.
- Business rules (featured selection, category ranking, search capability checks, email composition) are pure functions in `src/domain/`, not in routes or adapters.
- Environment variables are read only in `src/config.ts`. Everything else receives config as arguments.
- `src/app.ts` exports `createApp(deps)` and is kept separate from `src/server.ts` so tests can run the app without a port.
- All errors go through one error middleware (§5.9).
- `createContainer(config, overrides?)` is the composition root. Its **test seams** (production uses the defaults) are:
  - `createMailTransport`: default `nodemailer.createTransport`;
  - `fetch`: default the global `fetch`;
  - `writeLog`: default stdout;
  - `now`: the `Clock` for cache ages and debug durations, default `performance.now()`. The container passes it everywhere it passes the clock: both caches, the repository, the email service and the products route (`AppDeps.now`).
  - `Container.whenIdle()` resolves once the catalogue and image caches have no background refresh in flight (`TtlCache.whenIdle()`), so tests await it instead of sleeping.

`createApp` dependencies:

```ts
interface AppDeps {
  productRepository: ProductRepository;
  searchEngine: ProductSearchEngine;
  emailService: EmailService;
  logger: Logger;
  now: Clock;                   // durations (search.executed); injected so tests control time
  settings: {
    featuredProductIds: readonly number[];
    salesInboxEmail: string;
    mailFrom: string;
    jsonBodyLimit: string;      // e.g. "10kb"
    imageClientMaxAgeSeconds: number;
  };
}
```

### 5.4 Ports (interfaces)

```ts
// domain/product.ts
interface Product {
  id: number;
  title: string;
  description: string;
  category: string;
  price: number;          // major units
  currency: string;       // ISO 4217, set by the adapter (Fake Store = "USD")
  rating: { rate: number; count: number };
}

// ports/ProductRepository.ts — source of truth for product data
interface ProductRepository {
  getAll(): Promise<readonly Product[]>;
  getById(id: number): Promise<Product | undefined>;
  getByIds(ids: readonly number[]): Promise<Product[]>;   // keeps input order, skips missing ids
  listCategories(): Promise<string[]>;
  getImage(id: number): Promise<ProductImage | undefined>; // D-001
}
interface ProductImage { contentType: string; data: Uint8Array }

// ports/ProductSearchEngine.ts — finds ids; never the source of product data
type FilterName = 'q' | 'category' | 'minPrice' | 'maxPrice' | 'minRating';
type SortOption = 'relevance' | 'rating_desc' | 'price_asc' | 'price_desc' | 'title_asc';
interface SearchCapabilities {
  filters: ReadonlySet<FilterName>;
  sorts: ReadonlySet<SortOption>;
}
interface SearchQuery {
  q?: string; category?: string;
  minPrice?: number; maxPrice?: number; minRating?: number;
  sort: SortOption;          // defaulted to 'relevance' by the route
  page: number;              // defaulted to 1
  pageSize: number;          // defaulted to 20, max 50
}
interface SearchResult { ids: number[]; total: number }  // ids = the requested page only
interface ProductSearchEngine {
  readonly name: string;                     // used in logs, e.g. "in-memory"
  readonly capabilities: SearchCapabilities;
  index(products: readonly Product[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
}

// ports/EmailService.ts
interface EmailMessage {
  to: string; from: string;
  replyTo: { name: string; address: string };
  subject: string;
  text: string;              // plain text only, never HTML
}
interface EmailService { send(message: EmailMessage): Promise<void> }  // throws on failure

// ports/Logger.ts
interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
```

Adapters signal upstream failures by throwing `UpstreamError`; "not found" is `undefined`, never an exception.

### 5.5 Domain rules (pure functions)

- **Ranking** — `compareByRating(a, b)`: `rating.rate` desc, then `rating.count` desc, then `id` asc. Every "highest rated" choice uses this.
- **Featured** — `selectFeatured(all, featuredIds, count = 5)`: walk `featuredIds` in order, keep existing products, drop duplicates; if fewer than `count`, append the highest-rated products not yet included; return at most `count`. The count of 5 is a fixed domain constant, not config.
- **Category split** — `splitTopRated(productsInCategory, topCount = 3)`: `topRated` = first 3 by `compareByRating`; `rest` = remaining products in their original (upstream) order.
- **Search match** — `matchesText(product, q)`: `q` already trimmed; case-insensitive substring of the whole phrase in `title`, `description` or `category` (not tokenised).
- **Search filters** — `matchesFilters(product, query)`: every filter present must hold (AND).
  - `q` via `matchesText` (enabled in the running app).
  - *Additional, built and unit-tested, not enabled in the running app:* `category` (case-insensitive equality), `minPrice ≤ price ≤ maxPrice` (inclusive, each bound optional), `rating.rate ≥ minRating`.
- **Search sorts** — `compareForSort(sort)`:
  - `relevance` = upstream order (enabled in the running app).
  - *Additional, built and unit-tested, not enabled in the running app:* `rating_desc` = `compareByRating`; `price_asc` / `price_desc` = by price, ties by `id` asc; `title_asc` = case-insensitive title (`localeCompare`, base sensitivity), ties by `id` asc.
- **Category match** — `sameCategory(a, b)`: case-insensitive equality, used by the category filter and by `GET /categories/{category}` (§6.8).
- **Capabilities** — two named sets, so an engine's capabilities are always explicit:
  - `textSearchOnly()`: filter `q`, sort `relevance`. This is what the running app uses.
  - `allCapabilities()`: every filter and sort.
  - Paging is always supported and isn't listed.
- **Capability check** — `findUnsupported(query, capabilities)`: returns each filter present in the query, and the sort, that the engine doesn't support, as `{ param, value }` pairs.
- **Enquiry email** — `buildEnquiryEmail(product, enquiry, settings) → EmailMessage` (§5.8).

### 5.6 Fake Store adapter (`FakeStoreProductRepository`)

- Receives through its constructor:
  - `fetch`, `baseUrl` and `timeoutMs`
  - `imageHostAllowlist`, `imageTimeoutMs` and `imageMaxBytes`
  - two `TtlCache` instances, `catalogueCache` and `imageCache`, created in `container.ts`, which owns the TTL, stale cap, retry back-off, size bound, clock, and the cache's `name` and `Logger` (for the `cache.*` debug events, §5.11)
  - a `Logger`, and a `Clock` (`now`) for the `upstream.request` / `image.fetched` durations
- **One upstream call for data:** `GET {baseUrl}/products` loads the whole catalogue (≈20 items). `getById`, `getByIds` and `listCategories` are derived from that cached snapshot (categories = distinct values in first-seen order).
- **Timeout:** every catalogue request uses `AbortSignal.timeout(PRODUCT_API_TIMEOUT_MS)` (images have their own, below).
- **Cache: stale-while-revalidate** (D-011). The catalogue snapshot, and each image, is held in a `TtlCache`. A request never waits for Fake Store when a usable copy exists.

  | Copy's age | What the request gets | Upstream |
  |---|---|---|
  | No copy yet (first load, or evicted) | Waits for the fetch | Foreground fetch. Failure → `UpstreamError` (502). Failures are not cached and there's no back-off. |
  | < `PRODUCT_CACHE_TTL_SECONDS` (300) | The cached copy (fresh) | None |
  | TTL ≤ age ≤ `PRODUCT_STALE_MAX_AGE_SECONDS` (24 h) | The cached copy **immediately**, marked stale | A background refresh starts, unless one is already running for that key or the back-off window is open |
  | > 24 h | Waits for a refresh | Foreground refresh, ignoring the back-off. Failure → `UpstreamError` (502) |

  - **Background refresh:**
    - Only one runs per key at a time. Concurrent requests don't start another; they reuse it, and they're served the stale copy meanwhile.
    - On success, the new copy and its timestamp replace the old ones.
    - On failure, one warning is logged (`catalogue.refresh_failed` / `image.refresh_failed`, with the copy's age and the reason), and the old copy keeps being served.
    - Its errors are always caught, so it never causes an unhandled rejection.
  - **Retry back-off:** after a failed background refresh, no new refresh starts for `CACHE_RETRY_BACKOFF_SECONDS` (default 30). The first request after the window starts one.
  - **Single-flight:** foreground and background loads share one in-flight request per key.
  - **Testing:** `TtlCache.whenIdle()` resolves once all background refreshes have settled, so tests never depend on timing.
  - The caches are `TtlCache` instances created in `container.ts` and injected into the adapter.
- **Startup warm-up:** once the server is listening, `startServer` (`src/startup.ts`) starts one catalogue load. It doesn't block startup. If Fake Store is down, it logs a warning (`catalogue.warmup_failed`) and the server keeps running; the first request then does the foreground fetch.
- **Validation:** upstream JSON is parsed with a zod schema. Timeout, network error, non-2xx or schema mismatch → `UpstreamError` (details logged, never returned to the client).
  - All or nothing (D-028): one malformed product rejects the whole response. The result is then the stale copy or a 502, never a partly valid catalogue.
- **Mapping:** Fake Store `{ id, title, price, description, category, image, rating }` → `Product` with `currency: "USD"`. The upstream `image` URL is kept internal to the adapter and never exposed by the API.
- **Images** (D-001): `getImage(id)` looks up the product's internal image URL, then applies these guards. Each failure → `UpstreamError`, with details logged.
  1. **Host allowlist:** the scheme is `http`/`https` and the host is exactly one of `IMAGE_HOST_ALLOWLIST`. Otherwise no request is made.
  2. **No redirects:** fetched with `redirect: 'error'`, so a redirect can't lead outside the allowlist.
  3. **Timeout:** `AbortSignal.timeout(IMAGE_TIMEOUT_MS)`.
  4. **Content type:** only `image/jpeg`, `image/png`, `image/webp` and `image/gif` pass through. Parameters are ignored and case doesn't matter. Anything else is rejected, including `image/svg+xml` (SVG can carry scripts). The response uses the normalised type, e.g. `image/png`.
  5. **Max size:** rejected if `Content-Length` exceeds `IMAGE_MAX_BYTES`. Reading the body also stops once it passes the limit, which covers a missing or wrong `Content-Length`.
  - Image bytes are kept in a bounded in-memory cache (`IMAGE_CACHE_MAX_ENTRIES`, least recently used evicted) with the same stale-while-revalidate behaviour, back-off and cap as the catalogue. A failed background refresh is logged as `image.refresh_failed`.
  - The route sets cache headers on the response (§6.6).

### 5.7 Search design

Two responsibilities, two ports:

- `ProductRepository` is the source of truth for product data.
- `ProductSearchEngine` only answers "which ids, in which order, how many in total".

**Flow for `GET /products`:**
1. Validate the shape of all query params (§6.4). Apply defaults (`sort=relevance`, `page=1`, `pageSize=20`).
2. `findUnsupported(query, engine.capabilities)`. If anything is unsupported:
   - log one warning per item through the injected `Logger`: `search.unsupported` with `param`, `value` and `engine` (`engine.name`);
   - respond 400 `VALIDATION_ERROR` naming it, e.g. `Filter 'minPrice' is not supported yet.` or `Sort 'price_asc' is not supported yet.`
   - A filter is never silently ignored, and an engine never receives a query it hasn't declared support for.
3. **Index sync** (D-008): `engine.index(await repository.getAll())`. The repository call is a cache hit, and the in-memory engine skips re-indexing when it gets the same snapshot. A hosted engine would be fed by an ingestion job instead.
4. `{ ids, total } = await engine.search(query)`.
5. `items = await repository.getByIds(ids)` (order kept).
6. Respond `{ items, total, page, pageSize }`.

**`InMemorySearchEngine`:**
- Constructor: `new InMemorySearchEngine({ name = 'in-memory', capabilities = textSearchOnly() })`.
  - With no options, it does **text search only**. Nothing extra is enabled by default.
  - `container.ts` still passes `{ capabilities: textSearchOnly() }` explicitly, so what the running app supports is visible at the composition root.
- **The running app does text search only** (D-008): `q`, `relevance` and paging. Any other filter or sort gets a 400 `VALIDATION_ERROR` plus a `search.unsupported` warning.
- *Additional, built and unit-tested, not enabled in the running app:* the `category`, `minPrice`, `maxPrice` and `minRating` filters and the `rating_desc`, `price_asc`, `price_desc` and `title_asc` sorts. They switch on by creating the engine with `allCapabilities()`, or by plugging in a real engine that declares them. No route or contract change is needed.
- The engine applies `matchesFilters` and `compareForSort` (§5.5), then pages. If enabled, an unknown category used as a filter gives an empty result, not a 404.

Category "top rated" stays a domain function (`splitTopRated`), not engine sorting.

**Why ids first, then a store lookup** (D-027): the engine returns ids and the repository loads the products in one batched `getByIds`. Prices and details therefore always come from the source of truth, never from a possibly stale index. The cost is one extra lookup: microseconds in memory, a few ms against a database. If latency ever matters, the index can store full products instead without changing the API.

Swapping engines (e.g. OpenSearch) = a new adapter implementing `ProductSearchEngine` with wider `capabilities`, wired in `container.ts`. No route or iOS change: the iOS `ProductQuery` already carries every field.

### 5.8 Enquiry email

- `To`: `SALES_INBOX_EMAIL`. `From`: `MAIL_FROM`. `Reply-To`: `{ name, address: email }` of the customer (passed to nodemailer as an address object, so it encodes it).
- `Subject`: `Product enquiry: {product title}` — CR/LF stripped from the title (upstream data, defence in depth).
- Plain text body: product id and title, customer name, customer email, message (or "(no message)"), received timestamp (ISO 8601, UTC). Never HTML.
- Sending is synchronous; failure → 502 `UPSTREAM_ERROR`. No queueing or retries.
- **SMTP timeout:** the transport is created with `connectionTimeout`, `greetingTimeout` and `socketTimeout` all set to `SMTP_TIMEOUT_MS` (default 10000).
  - Without these, nodemailer's defaults apply: 2 min to connect, 30 s for the greeting and 10 min of socket inactivity. A hanging mail server could stall an enquiry for minutes.
  - A send that hits the timeout fails like any other delivery failure: `UpstreamError` → 502.
- **Amazon SES** works through its SMTP interface by config alone, with no code change:
  - `SMTP_HOST=email-smtp.<region>.amazonaws.com`
  - `SMTP_USER` / `SMTP_PASS` = the SES SMTP credentials
  - either **port 587 with `SMTP_SECURE=false`**: the connection starts plain and is upgraded with STARTTLS, which nodemailer does automatically when the server offers it, and SES requires it before AUTH;
  - or **port 465 with `SMTP_SECURE=true`**: TLS from the first byte.
- Logs record the product id and outcome only, not the customer's name, email or message.
- `SmtpEmailService` receives `(transport, logger, now)`. It logs `email.sending` / `email.sent` at debug with `durationMs` only: no addresses, names, subject or body (§5.11).
- `SmtpEmailService` depends on a narrow `MailTransport` interface (`sendMail` only), not on nodemailer types.
  - The nodemailer transport is created in `container.ts` from `smtpTransportOptions(config)`, through an injectable factory (default `nodemailer.createTransport`), so tests can check the options it receives.
  - Tests use nodemailer's stream transport (no SMTP server) or a stub transport.

### 5.9 Errors

All responses for errors use one envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable, safe message." } }
```

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid/unknown query params or body fields, malformed JSON, body over limit, unsupported filter/sort |
| `NOT_FOUND` | 404 | Unknown route, unknown product id, unknown category in `GET /categories/:category` |
| `UPSTREAM_ERROR` | 502 | Product source or email provider failed (timeout, network, bad response) |
| `INTERNAL_ERROR` | 500 | Anything unexpected |

The single error middleware maps `AppError` subclasses to the table, maps anything else to `INTERNAL_ERROR`, logs the full error server-side, and never returns stack traces, internal hostnames or upstream bodies. These four codes are the complete set.

### 5.10 Configuration

Read and validated only in `src/config.ts`. The app fails fast at startup on invalid config and lists every problem. All variables are in the root `.env.example` with safe local values.

Every variable is one of three kinds:
- **Required:** environment-specific (URLs, hosts, addresses, ids). There is no default in code, so the app won't start without it.
- **Default:** a tuning value. `config.ts` holds the default, and `.env.example` repeats it.
- **Optional:** may be left empty.

| Variable | Kind | Default / `.env.example` value | Notes |
|---|---|---|---|
| `PORT` | Default | `3000` | |
| `LOG_LEVEL` | Default | `info` | `debug` \| `info` \| `warn` \| `error` |
| `PRODUCT_API_BASE_URL` | **Required** | `https://fakestoreapi.com` | `http`/`https` URL |
| `PRODUCT_API_TIMEOUT_MS` | Default | `5000` | Per catalogue request |
| `PRODUCT_CACHE_TTL_SECONDS` | Default | `300` | Catalogue + image copies are fresh this long; after it, they are served stale while a background refresh runs |
| `PRODUCT_STALE_MAX_AGE_SECONDS` | Default | `86400` | Oldest copy (catalogue or image) that may be served when a refetch fails |
| `CACHE_RETRY_BACKOFF_SECONDS` | Default | `30` | After a failed background refresh, don't start another for this long (catalogue and images) |
| `IMAGE_HOST_ALLOWLIST` | **Required** | `fakestoreapi.com` | Comma-separated hostnames, exact match; at least one |
| `IMAGE_TIMEOUT_MS` | Default | `5000` | Per image request |
| `IMAGE_CACHE_MAX_ENTRIES` | Default | `100` | Bounded image cache |
| `IMAGE_MAX_BYTES` | Default | `5242880` | 5 MB |
| `IMAGE_CLIENT_MAX_AGE_SECONDS` | Default | `86400` | `Cache-Control` on image responses |
| `FEATURED_PRODUCT_IDS` | **Required** | `1,5,9,13,17` | Ordered, comma-separated positive integers. Must be set; may be empty (Home is then filled by rating). |
| `SMTP_HOST` | **Required** | `mailpit` | `localhost` when running the API outside Docker |
| `SMTP_PORT` | **Required** | `1025` | |
| `SMTP_SECURE` | Default | `false` | `true` \| `false`. `false` for Mailpit and for SES on port 587 (STARTTLS); `true` for SES on port 465 (§5.8) |
| `SMTP_TIMEOUT_MS` | Default | `10000` | Connection, greeting and socket timeout for the SMTP transport; a hung send → 502 |
| `SMTP_USER` / `SMTP_PASS` | Optional | empty | Empty = no auth (Mailpit) |
| `MAIL_FROM` | **Required** | `catalogue@example.com` | Valid email address |
| `SALES_INBOX_EMAIL` | **Required** | `sales@example.com` | Valid email address |
| `JSON_BODY_LIMIT` | Default | `10kb` | |

### 5.11 Log events

One JSON line per event on stdout (`JsonLogger`): `{ time, level, msg, ...context }`. `msg` is a stable event name. `LOG_LEVEL` (default `info`) drops anything below it.

**Rules:**
- **Debug events are for troubleshooting only.** Nothing changes at the default `LOG_LEVEL=info`.
- **No customer data and no secrets in any line, at any level.** That means no customer names, email addresses or messages; no `SMTP_USER` or `SMTP_PASS`; no configured email addresses.
- **Durations come from the injected `Clock`** (`now`, created in `container.ts`), never from scattered `Date.now()` calls, so tests can control them. Durations and ages are whole milliseconds.
- **The logger and clock are injected through constructors and options.** Only `container.ts` creates concrete ones.

| Event | Level | Where | Context |
|---|---|---|---|
| `config.loaded` | debug | `container.ts`, once at startup | allowlisted safe values only (`safeConfigSummary`): `port`, `logLevel`, cache TTL / stale cap / retry back-off, upstream / image / SMTP timeouts, image cache size and limits, `featuredProductIds`, `imageHostAllowlist`, `smtp: { host, port, secure }`. Never `SMTP_USER`, `SMTP_PASS` or email addresses. |
| `cache.hit` | debug | `TtlCache` | `cache` (`catalogue` \| `image`), `key`, `ageMs` |
| `cache.stale` | debug | `TtlCache` | `cache`, `key`, `ageMs`. The copy is served while a background refresh may start. |
| `cache.miss` | debug | `TtlCache` | `cache`, `key`, `ageMs` (`null` when there is no copy; the age when past the cap). The request waits. |
| `upstream.request` | debug | Fake Store adapter, catalogue fetch | `path`, `status` (HTTP status, `"timeout"` or `"network_error"`), `durationMs` |
| `image.fetched` | debug | Fake Store adapter | `productId`, `bytes`, `contentType`, `durationMs` |
| `search.executed` | debug | products route | `q`, `filters` (only those present), `sort`, `page`, `pageSize`, `total`, `durationMs` |
| `email.sending` | debug | `SmtpEmailService` | none |
| `email.sent` | debug | `SmtpEmailService` | `durationMs` only |
| `server.started` | info | `startup.ts` | `port` |
| `catalogue.warmed` | info | `startup.ts` | `products` (count) |
| `enquiry.sent` | info | enquiries route | `productId` |
| `request.rejected` | info | error middleware (4xx) | `method`, `path`, `status`, `code`, `message` |
| `server.stopping` | info | `server.ts` | `signal` |
| `search.unsupported` | warn | products route | `param`, `value`, `engine` |
| `catalogue.refresh_failed` | warn | Fake Store adapter | `ageSeconds`, `reason` |
| `image.refresh_failed` | warn | Fake Store adapter | `productId`, `ageSeconds`, `reason` |
| `catalogue.warmup_failed` | warn | `startup.ts` | `reason` |
| `request.failed` | error | error middleware (5xx) | `method`, `path`, `status`, `code`, `error` (serialised, with cause) |
| `server.close_failed` | error | `server.ts` | `error` |
| `server.shutdown_timeout` | error | `server.ts` | `graceMs` |
| `server.start_failed` | error | `server.ts`, written to stderr before a logger exists | `message` |

---

## 6. API contract

Base URL: `http://localhost:3000` locally. JSON in and out (except images). No versioning prefix for the PoC (see DECISIONS).

### 6.1 Product (response shape)

```json
{
  "id": 1,
  "title": "Fjallraven - Foldsack No. 1 Backpack",
  "description": "Your perfect pack for everyday use…",
  "category": "men's clothing",
  "price": 109.95,
  "currency": "USD",
  "rating": { "rate": 3.9, "count": 120 }
}
```

There is no image URL in the payload. Every product's image is at `GET /products/{id}/image`.

### 6.2 `GET /health`

Liveness only; does not call upstream services (so an upstream outage doesn't get instances replaced).
`200 { "status": "ok" }`

### 6.3 `GET /products/featured` (AC-1)

`200 { "items": Product[] }` — up to 5, rule §5.5. Errors: `UPSTREAM_ERROR`.

### 6.4 `GET /products` (AC-3, search and listing)

| Param | Shape | Meaning (§5.5) | Running app |
|---|---|---|---|
| `q` | string, trimmed, 1–100 chars; present-but-blank → 400 | case-insensitive match on title, description or category | ✅ enabled |
| `category` | string, 1–100 chars | category, case-insensitive | additional: 400 |
| `minPrice`, `maxPrice` | number ≥ 0; `minPrice ≤ maxPrice` | inclusive price bounds | additional: 400 |
| `minRating` | number 0–5 | `rating.rate ≥ minRating` | additional: 400 |
| `sort` | `relevance` \| `rating_desc` \| `price_asc` \| `price_desc` \| `title_asc` (default `relevance`) | result order | `relevance` ✅; others additional: 400 |
| `page` | integer ≥ 1 (default 1) | | ✅ always |
| `pageSize` | integer 1–50 (default 20) | | ✅ always |

"Additional" means built and unit-tested, but not enabled in the running app (§5.7, D-008). The full contract and its shape validation stay in place, so enabling a capability needs no API change.

- **Absent vs empty:**
  - An absent param is not applied (filters) or gets its default (`sort`, `page`, `pageSize`).
  - A param that is **present but empty** returns 400 `VALIDATION_ERROR`. That includes whitespace-only for `q` and `category`, e.g. `?category=`, `?minPrice=`, `?sort=` or `?page=`. An empty value is never treated as "not set".
- Unknown params or repeated params → 400 `VALIDATION_ERROR`.
- Shape is validated first, then engine support (§5.7). The running app's engine supports `q`, `relevance` and paging. Every other filter or sort → 400 `VALIDATION_ERROR` naming it (e.g. `Filter 'category' is not supported yet.`) plus a `search.unsupported` warning.
- No params → all products, paged.

`200 { "items": Product[], "total": number, "page": number, "pageSize": number }`

### 6.5 `GET /products/{id}` (AC-4)

`id` must be a positive integer (else 400). `200 Product`. Unknown id → 404 `NOT_FOUND`.

### 6.6 `GET /products/{id}/image`

`200` with the image bytes and these headers:
- `Content-Type`: one of `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- `Cache-Control: public, max-age={IMAGE_CLIENT_MAX_AGE_SECONDS}`
- `X-Content-Type-Options: nosniff`

Errors:
- Invalid id → 400.
- Unknown product → 404.
- Any image guard failing (host not allowlisted, redirect, timeout, disallowed type such as SVG, too large) or another upstream failure, with no cached copy → 502.

### 6.7 `GET /categories`

`200 { "items": string[] }` — e.g. `["men's clothing", "jewelery", "electronics", "women's clothing"]` (upstream spelling kept).

### 6.8 `GET /categories/{category}` (AC-2)

`category` is URL-encoded by the client (e.g. `men's%20clothing`). It matches **case-insensitively**: `/categories/JEWELERY` works.
`200 { "category": string, "topRated": Product[], "rest": Product[] }` — rule §5.5. `category` in the response is the name **as the data spells it** (`jewelery`), not as requested. Unknown category → 404.

### 6.9 `POST /enquiries` (AC-5)

Request body (`Content-Type: application/json`, unknown fields rejected):

| Field | Rule |
|---|---|
| `productId` | required, positive integer **JSON number**, must exist (else 404 `NOT_FOUND`). `"7"` (a string), `7.5`, `0` and `-1` → 400 |
| `name` | required, trimmed, 1–100 chars, no CR/LF or other control characters |
| `email` | required, trimmed, valid email address, ≤ 254 chars, no CR/LF |
| `message` | optional, ≤ 2000 chars (line breaks allowed; it only goes into the body) |

`200 { "status": "sent" }` once the email has been accepted by the SMTP server.
Errors: 400 validation, 404 unknown product, 502 email or product source failure.

---

## 7. iOS app

### 7.1 Stack

Why this stack: D-025.

- SwiftUI, Swift 6 language mode (strict concurrency), deployment target **iOS 18.0** (D-013). Requires **Xcode 16 or newer**.
- Swift Concurrency only (`async`/`await`); no completion handlers, no Combine.
- Tests with Swift Testing.
- **No third-party dependencies.** The Xcode project uses synchronized folder groups (Xcode 16+), so files added to a folder are picked up without editing the project file; no project generator.
- Built and tested with Xcode 26.

### 7.2 Structure

```
ios/
├── Catalogue.xcodeproj
├── Config/                  # Debug.xcconfig / Release.xcconfig (API_BASE_URL, REQUEST_TIMEOUT_SECONDS)
├── Catalogue/
│   ├── App/                 # CatalogueApp (@main), AppConfiguration, AppDependencies,
│   │                        # AppCoordinator, CoordinatorView, Route, Sheet, CatalogueNavigating
│   ├── Networking/          # NetworkClient (protocol), URLSessionNetworkClient, Endpoint,
│   │                        # Endpoints, APIError, ErrorEnvelope
│   ├── Models/              # Product, Rating, CategoryProducts, ProductPage, ProductQuery, Enquiry
│   ├── Services/            # ProductService, CategoryService, EnquiryService, ImageService
│   │                        # (protocol + live implementation each)
│   ├── Features/
│   │   ├── Home/  Category/  Search/  ProductDetail/  Enquiry/   # View + ViewModel per screen
│   ├── Shared/              # ViewState, ErrorMessages, ProductImageLoader, ProductTile, StateContainerView
│   └── Theme/               # AppTheme tokens + environment key
└── CatalogueTests/          # mocks + tests (§9.2)
```

### 7.3 MVVM-C layering

Strict direction: **View → ViewModel → Service protocol → `NetworkClient`**. No layer skips another or calls upwards.

- **Views** only render state and forward user intents. No networking, business logic, navigation decisions or data formatting beyond display. Each screen view holds its ViewModel in `@State`, initialised once via `_viewModel = State(initialValue:)`.
- **ViewModels** are `@Observable` and `@MainActor`. They receive service protocols and a `CatalogueNavigating` navigator through `init`, expose `ViewState<T>` plus a `retry()` action, and never import SwiftUI view types or touch `URLSession`.
- **Services** receive a `NetworkClient` through `init`, call endpoints and return domain models. They hold no UI state.

```swift
enum ViewState<Value> {
    case loading
    case loaded(Value)
    case empty
    case error(message: String)
}
```

### 7.4 Coordinator and navigation

- One `AppCoordinator` (`@Observable`, `@MainActor`) owns all navigation state: `path: [Route]` and `sheet: Sheet?`. No child coordinators (D-026). It can be split per flow later, e.g. checkout.
- It is the only place that creates screens and ViewModels, from `AppDependencies`. New screens = a new `Route`/`Sheet` case + a factory branch in the coordinator.
- No `NavigationLink(destination:)`, `isPresented` flags or navigation state in views or ViewModels.
- ViewModels navigate only through `CatalogueNavigating`; they never reference `AppCoordinator`, `Route` or other screens.
- Single `NavigationStack` rooted at Home (no tab bar), with `.navigationDestination(for: Route.self)` and `.sheet(item:)` bound to the coordinator.

```swift
enum Route: Hashable {
    case category(String)
    case product(id: Int)
    case searchResults(query: String)
}

enum Sheet: Identifiable {
    case enquiry(productId: Int, productTitle: String)
}

@MainActor
protocol CatalogueNavigating: AnyObject {
    func showCategory(_ category: String)
    func showProduct(id: Int)
    func showSearchResults(query: String)
    func showEnquiry(productId: Int, productTitle: String)
    func dismissSheet()
}
```

### 7.5 Networking

- All HTTP goes through the central `NetworkClient`, images included. Nothing else uses `URLSession`, `URLRequest` or `JSONDecoder` for network calls.
- Requests are `Endpoint` values (method, path, query items, body) defined in `Endpoints.swift`. URLs are built with `URLComponents` / `URLQueryItem`, never string concatenation.

```swift
protocol NetworkClient: Sendable {
    func send<Response: Decodable & Sendable>(_ endpoint: Endpoint, as type: Response.Type) async throws(APIError) -> Response
    func data(for endpoint: Endpoint) async throws(APIError) -> Data   // raw bytes, e.g. images
}
```

| Endpoint | Request |
|---|---|
| `featured` | `GET /products/featured` |
| `products(ProductQuery)` | `GET /products` + only the non-nil query fields |
| `product(id:)` | `GET /products/{id}` |
| `productImage(id:)` | `GET /products/{id}/image` |
| `categories` | `GET /categories` |
| `category(_:)` | `GET /categories/{category}` (path-encoded) |
| `createEnquiry(EnquiryRequest)` | `POST /enquiries`. `EnquiryRequest.productId` is a Swift `Int`, so it is encoded as a positive integer JSON number (`7`, never `"7"` or `7.5`). The backend returns 400 for anything else (§6.9). |

`ProductQuery` mirrors §6.4 with every field optional (`q`, `category`, `minPrice`, `maxPrice`, `minRating`, `sort`, `page`, `pageSize`). The search screen currently sends `q` only; no sort/filter UI yet.

**Endpoints never sends empty values.** A `nil` field is omitted, and so is a string that is empty after trimming. The backend rejects present-but-empty params with 400 (§6.4), so the app must never produce `?q=` or `?category=`.

`APIError` (typed, `Equatable`):

| Case | From |
|---|---|
| `.validation(message:)` | 400 `VALIDATION_ERROR` |
| `.notFound` | 404 `NOT_FOUND` |
| `.upstream` | 502 `UPSTREAM_ERROR` |
| `.server(status:)` | 500 `INTERNAL_ERROR` or any other non-2xx / unknown envelope |
| `.offline` | `URLError` not connected / connection lost |
| `.timeout` | `URLError.timedOut` |
| `.decoding` | response body doesn't decode |
| `.transport` | any other `URLError` |

ViewModels turn `APIError` into user-facing text through one pure function in `Shared/ErrorMessages.swift`; raw errors are never shown.

### 7.6 Images

- `ImageService.image(forProductId:) async throws(APIError) -> UIImage` loads `productImage(id:)` through `NetworkClient` and keeps decoded images in an `NSCache` owned by the service instance (created in `AppDependencies`).
- To keep "views never call services": a `ProductImageLoader` (`@Observable`, `@MainActor`, holds `[Int: ImageState]`) is owned by each ViewModel that shows tiles. Views forward a "tile appeared" intent (`viewModel.loadImage(for:)`) and render `viewModel.imageState(for:)` (loading placeholder / image / failed placeholder).

### 7.7 Configuration and DI

- `AppConfiguration` is loaded once at launch from `Info.plist`: `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS`, set through `Config/*.xcconfig`. Debug uses `http://localhost:3000`. No backend URL or timeout in Swift source.
- Invalid or missing config → `AppConfiguration` throws; the app shows a plain configuration-error screen instead of crashing.
- `Info.plist` sets `NSAppTransportSecurity › NSAllowsLocalNetworking = YES` so plain HTTP works against `localhost` only.
- `AppDependencies` is built once in the `@main` `App` from `AppConfiguration` and injected into `AppCoordinator`. Views never reach for dependencies themselves. `AppDependencies.mock` is the test graph.
- **Previews** use the real ViewModel with mock services. **Tests** use `AppDependencies.mock`, mock services and a mock navigator, never the live client.

### 7.8 Screens

| Screen | Data | States | Intents |
|---|---|---|---|
| **Home** (root) | `featured` + `categories` loaded concurrently → `ViewState<HomeContent>` | loading / loaded / empty (no featured and no categories) / error+retry | tap tile → `showProduct`; tap category → `showCategory`; `.searchable` + `.onSubmit(of: .search)` → `showSearchResults`. Search stays disabled while the trimmed text is empty (see below). |
| **Category** | `category(_:)` → `ViewState<CategoryProducts>` | sections "Top rated" and "More in {category}" (second hidden when empty); empty; error+retry | tap tile → `showProduct` |
| **Search results** | `products(ProductQuery(q:))` → `ViewState<ProductPage>` | loaded list; empty = "No products match '{q}'"; error+retry | `.searchable` prefilled with the query; resubmitting reloads in place; search disabled while the trimmed text is empty; tap tile → `showProduct` |

**Search stays disabled while the trimmed text is empty.**
- The keyboard's Search key is disabled while the field is empty, which is the system default for `.searchable`.
- The ViewModel's `canSearch` is `false` for whitespace-only text, so submitting does nothing and no request is sent.
| **Product detail** | `product(id:)` → `ViewState<Product>` | loaded; **empty = 404 "This product is no longer available"**; error+retry | "Enquire" → `showEnquiry` |
| **Enquiry** (sheet) | `createEnquiry` | form state: `editing` → `submitting` → `submitted` (thank-you) or `failed(message)` | client-side validation mirrors §6.9 (submit disabled until valid); submit; on thank-you "Done" → `dismissSheet` |

Thank-you copy: "Thank you, {name}. Our sales team will reply to {email} soon."
Price display: formatted in the ViewModel with the product's `currency`.

### 7.9 Theme

`AppTheme` holds all colors, fonts, spacing and corner radii as tokens. It is a value passed into the view tree through a SwiftUI environment key, set once at the root from `AppDependencies`, so a new look and feel = a new `AppTheme` value. No hardcoded colors, fonts, spacing or radii in views.

---

## 8. Local development and infrastructure

### 8.1 Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack or Colima).
- **Xcode 16 or newer** (built with Xcode 26) and an iOS 18+ simulator.
- Optional, for running backend tests outside Docker: Node.js 24 (`.nvmrc`).

### 8.2 Run (target: under 10 minutes)

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:3000 (`/health` to check)
- Mailpit inbox UI: http://localhost:8025 (SMTP on 1025)

Then open `ios/Catalogue.xcodeproj`, pick an iPhone simulator, Run. The Debug config already points at `http://localhost:3000`.

`docker-compose.yml` services:
- `api` — built from `backend/Dockerfile`, env from `.env`, port 3000, depends on `mailpit`, healthcheck on `/health`.
- `mailpit` — `axllent/mailpit` (pinned tag), ports 8025 and 1025.

### 8.3 AWS readiness

- Multi-stage `Dockerfile` (build with dev deps → runtime image with prod deps only), runs as a non-root user, `node dist/server.js`.
- Stateless: the only state is a per-instance cache, so it scales horizontally behind an ALB (ECS Fargate or App Runner).
- `/health` for target-group/App Runner health checks.
- Config only from environment (ECS task definition / Secrets Manager for SMTP credentials later).
- JSON logs to stdout → CloudWatch Logs.
- Graceful shutdown on `SIGTERM` (stop accepting connections, finish in-flight requests).
- Catalogue warm-up after listening (§5.6), so the first user request after a deploy is normally served from the cache.
- Email in production: Amazon SES via its SMTP interface works with the existing `SmtpEmailService` by config alone: port 587 with `SMTP_SECURE=false` (STARTTLS), or port 465 with `SMTP_SECURE=true` (§5.8). An SES-API adapter would be a new `EmailService`.

### 8.4 README contents

The root `README.md` (written in the backend PR, completed in the iOS PR) covers:
- What the project is, with links to this blueprint, `DECISIONS.md` and `AI_USAGE.md`.
- **Prerequisites:**
  - Docker with Compose v2.
  - **Xcode 16 or newer**, which is required for the iOS 18 deployment target and the synchronized-folder project format.
  - An iOS 18+ simulator.
  - Optionally Node.js 24, for backend tests outside Docker.
- **Quick start:** the steps in §8.2, and where to see the enquiry email (Mailpit at http://localhost:8025).
- **Running tests:**
  - backend: `cd backend && npm ci && npm test` (Node 24), or with Docker only: `docker build --target test backend`
  - iOS: ⌘U in Xcode, or `xcodebuild test` with a simulator destination
- Configuration: a pointer to `.env.example` and §5.10.
- Troubleshooting: ports 3000, 8025 or 1025 already in use; the simulator can't reach the backend because the API isn't running.

---

## 9. Testing

Tests never hit the real network. They test behaviour through public interfaces, and each must be shown to fail when the behaviour breaks.

Tests never sleep. Time moves through an injected fake clock, and background work is awaited with `whenIdle()`.

### 9.1 Backend (Vitest)

| Area | How | Must cover |
|---|---|---|
| Domain | Unit tests on pure functions | ranking tie-break; `selectFeatured` (order kept, missing skipped, duplicates dropped, fill to 5, never >5, catalogue <5); `splitTopRated` (top 3, rest in upstream order, no duplicates, ≤3 products); `matchesText` (case-insensitive, title, description or category, phrase); `matchesFilters` (each filter, inclusive bounds, AND); `compareForSort` (each sort, tie-breaks); `findUnsupported`; `buildEnquiryEmail` (plain text, reply-to, subject CR/LF stripped) |
| Routes | Supertest against `createApp` with in-memory fakes of the ports | every endpoint's happy path and documented errors; error envelope shape; unknown fields/params → 400; CR/LF in `name`/`email` → 400; present-but-empty `GET /products` params (`category`, `minPrice`, `sort`, `page`) → 400; SVG image → 502; unknown route → 404; upstream failure → 502; email failure → 502; no stack traces in bodies; image response headers (`Content-Type`, `Cache-Control`, `nosniff`) |
| Search plug-and-play | Supertest + mock `Logger` | The **default `InMemorySearchEngine` (text search only)**: `category`, `minPrice`, `maxPrice`, `minRating` and each non-relevance sort → 400 naming it, with a warning logged (`param`, `value`, engine name); `q`, `sort=relevance` and paging work. A **fake engine supporting everything receives the exact parsed `SearchQuery`**, and the response items follow its id order and total. With `allCapabilities()`, the real engine serves `category` + sort through the route. |
| `InMemorySearchEngine` | Unit | default = `textSearchOnly()`; with `allCapabilities()`: each filter and sort (additional, not enabled in the running app), category filter case-insensitive, combined filters; paging and total; relevance = upstream order; searches the latest snapshot after re-indexing |
| Categories route | Supertest | `/categories/JEWELERY` matches and returns `jewelery` as the data spells it; unknown → 404 |
| Debug log events (§5.11) | Recording logger per component; end-to-end through `createContainer` with injected `fetch`, mail transport, log writer and a **fake clock** (`now`). Time is moved past the TTL and background refreshes are awaited with `container.whenIdle()`; no sleeps. | each event is logged with the expected context; with `LOG_LEVEL=info` none of them is written; `config.loaded` never contains `SMTP_USER`, `SMTP_PASS` or an email address; `email.sending` / `email.sent` never contain the customer's name, email or message |
| `container.ts` | Unit (no network) | the running app's search engine is `textSearchOnly()`; settings flow from config; the SMTP transport receives `connectionTimeout`, `greetingTimeout` and `socketTimeout` = `SMTP_TIMEOUT_MS` |
| Enquiry route (email) | Supertest | send fails (502): logs contain no customer name, email or message; tab, `\u0000` and `\u007F` in `name` and in `email` → 400; `productId` `7.5`, `0`, `-1` (and `"7"`) → 400 |
| `FakeStoreProductRepository` | Injected `fetch` returning recorded fixtures (`test/fixtures/fakestore/`) + fake clock + mock `Logger` | Mapping; single-flight; timeout, non-2xx or schema mismatch → `UpstreamError`.<br>**Stale-while-revalidate, catalogue and image:**<br>• an expired copy is returned without waiting for upstream (the upstream response is held back until after the assertion);<br>• exactly one background refresh for concurrent requests;<br>• a successful refresh replaces the copy;<br>• a failed refresh keeps serving the old copy and logs once;<br>• back-off is respected (no refresh inside the window, one after it);<br>• past the 24 h cap the request waits and gets `UpstreamError`;<br>• no copy + failure → `UpstreamError`.<br>**Image guards, one test each:** host not in allowlist (no request made); redirect rejected; timeout; JPEG/PNG/WebP/GIF accepted (normalised type), SVG and non-images rejected; oversize rejected, both by `Content-Length` and by the streamed body. |
| `SmtpEmailService` | nodemailer stream transport, a stub transport, and a local socket that never greets | headers (to, from, reply-to), plain text only; a transport rejecting with a timeout error → `UpstreamError`; a real nodemailer transport against a silent local server times out within `SMTP_TIMEOUT_MS` → `UpstreamError` |
| `TtlCache` | Unit with fake clock + `whenIdle()` | fresh hit; expired copy returned immediately and marked stale while one background refresh runs; refresh success replaces the copy; refresh failure keeps the copy, calls the error callback once and starts the back-off; no refresh inside the window, one after it; past the cap the call waits and rethrows; first load waits; a throwing error callback never causes an unhandled rejection; single-flight; bounded entries (oldest evicted) |
| `startup.ts` | Real server on port 0 + fake repository | `/health` answers while the warm-up is still pending; a failed warm-up logs `catalogue.warmup_failed` and the server keeps serving; a successful warm-up fills the cache |
| Routes (cache past cap) | Supertest + real `FakeStoreProductRepository` | catalogue older than 24 h and Fake Store down → `GET /products/featured` is 502 |
| `config.ts` | Unit | defaults, invalid values fail fast, `FEATURED_PRODUCT_IDS` parsing |

### 9.2 iOS (Swift Testing)

| Area | How | Must cover |
|---|---|---|
| `NetworkClient` | Stub `URLProtocol` | decoding; query items (only non-nil `ProductQuery` fields); path encoding of categories; envelope → `APIError` per code; offline/timeout/decoding mapping; raw data for images |
| Services | Mock `NetworkClient` | correct `Endpoint` per call; model mapping |
| ViewModels | Mock services + mock navigator | Loading → Loaded / Empty / Error; retry; navigation intents call the right navigator method; search submit (blank ignored); product 404 → empty; enquiry validation, submitting, thank-you, failure message, done → `dismissSheet` |
| `ErrorMessages` | Unit | every `APIError` → a user-facing message |
| `AppCoordinator` | Assert on `path` / `sheet` | each navigator method; dismiss clears sheet |
| `AppConfiguration` | Unit with test dictionaries | valid, missing and invalid `API_BASE_URL` / timeout |

### 9.3 Critical path traceability

| AC | Backend tests | iOS tests |
|---|---|---|
| AC-1 | `selectFeatured`, `GET /products/featured` | HomeViewModel |
| AC-2 | `splitTopRated`, `GET /categories`, `GET /categories/{c}` | HomeViewModel (category tap), CategoryViewModel |
| AC-3 | `matchesText`, engine, `GET /products` | SearchResultsViewModel, Endpoints query items |
| AC-4 | `GET /products/{id}`, image route | ProductDetailViewModel, ImageService |
| AC-5 | `buildEnquiryEmail`, `POST /enquiries`, `SmtpEmailService` | EnquiryViewModel, coordinator sheet |

Manual end-to-end check before each PR: run §8.2, walk AC-1…AC-5 in the simulator, see the email in Mailpit.

---

## 10. Delivery process

### 10.1 Branch and PR flow

1. Blueprint and docs are committed directly to `feature/product-catalogue`.
2. **Backend:** branch `feature/product-catalogue-backend` from `feature/product-catalogue` → PR back into `feature/product-catalogue`.
3. **iOS:** after the backend PR is merged, branch `feature/product-catalogue-ios` from `feature/product-catalogue` → PR back into `feature/product-catalogue`.
4. **Final:** PR `feature/product-catalogue` → `main`, kept open.

Nothing is committed to `main` directly. Pushing, opening PRs and merging happen only after the go-ahead. Remote: GitHub repo to be provided before the first PR.

### 10.2 Change process

Any change to requirements, architecture, the API contract, config, dependencies or screens is made in this file first (with a changelog entry), in the same PR as the code. Decisions that fill gaps go to `DECISIONS.md`.

### 10.3 Definition of done (per task)

- Code matches the blueprint section it implements.
- Relevant tests added and passing; each new test seen failing when the behaviour is broken.
- `DECISIONS.md` / `AI_USAGE.md` updated where relevant.
- Summary states what changed, which blueprint section it follows, and which tests ran.

---

## 11. Open questions

None open.

| ID | Question | Resolution (2026-11-25) |
|---|---|---|
| OQ-1 | Where does image fetching live? | `getImage(id)` on `ProductRepository` (D-001). |
| OQ-2 | When does the search engine get (re)indexed? | Before each search, skipped when the catalogue hasn't changed (D-008). |

---

## 12. Future (not in scope)

- **Tuist for the iOS project:** generate the project from a Swift manifest, so there are no `.xcodeproj` merge conflicts, and split it into modules (`Core`, `Networking`, `DesignSystem`, `Features`).
- **Cursor-based paging for search:** today paging is offset-based (`page`, `pageSize`), so items can shift between pages if the catalogue refreshes mid-browse. A cursor (for example, the last item's sort key and id) keeps pages stable.
- See `DECISIONS.md` → "What I'd do next" and "How it grows".

---

## 13. Changelog

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-11-25 | Initial blueprint: requirements, architecture, API contract, iOS design, config, tests, delivery flow. Project-specific rules moved here from `CLAUDE.md`. |
| 0.2 | 2026-11-25 | Review changes: search also matches category; `InMemorySearchEngine` supports all filters/sorts, with capabilities injected through its constructor and unsupported params logged as warnings; catalogue cache serves a stale copy when a refetch fails; image proxy guards (`IMAGE_HOST_ALLOWLIST`, `IMAGE_TIMEOUT_MS`, no redirects, `nosniff`); iOS 18 minimum / Xcode 16+; README contents (§8.4); open questions resolved; Tuist future note. |
| 0.3 | 2026-11-25 | Stale copies served for at most 24 h (`PRODUCT_STALE_MAX_AGE_SECONDS`). `errors.ts` moved to `src/` because adapters throw these errors too. Caches are created in the container and injected. `TtlCache` tests listed. Docker-only backend test command. |
| 0.4 | 2026-11-25 | Backend implementation sync. The structure gains `domain/email.ts` and `http/params.ts`. The engine's default capabilities come from `allCapabilities()`, a function, so no shared mutable set exists. Stale images are logged as `image.stale_served`. |
| 0.5 | 2026-11-25 | Drift fixes found in review (text only): `Logger` includes `debug`; the repository receives two `TtlCache` instances rather than a clock and limits; `SmtpEmailService` depends on a narrow `MailTransport`; test helpers live in `test/support/` and the only fixture is `products.json`; §5.10 marks each variable as required, default or optional. |
| 0.6 | 2026-11-25 | Review changes: retry back-off after a failed refresh (`CACHE_RETRY_BACKOFF_SECONDS`, default 30); images limited to JPEG, PNG, WebP and GIF (SVG rejected); all-or-nothing catalogue validation documented (D-028); `GET /products` absent vs present-but-empty params (§6.4); iOS `Endpoints` never sends empty values, and search is disabled while the trimmed text is empty (§7.5, §7.8). |
| 0.7 | 2026-11-25 | Cache switched to stale-while-revalidate: after the TTL the copy is returned immediately and refreshed in the background (one per key, errors always caught, back-off reused, 24 h cap still waits). `TtlCache.whenIdle()` for tests. Log events renamed to `catalogue.refresh_failed` / `image.refresh_failed`. Startup catalogue warm-up in the new `src/startup.ts`. Tests table updated. |
| 0.8 | 2026-11-25 | Search review. Category matching is case-insensitive everywhere (`sameCategory`; `/categories/JEWELERY` returns `jewelery`). Capabilities are explicit: `InMemorySearchEngine` defaults to `textSearchOnly()`, which `container.ts` passes explicitly. **The running app does text search only.** The other filters and sorts are labelled "additional, built and unit-tested, not enabled in the running app". §6.4 has a "running app" column. |
| 0.9 | 2026-11-25 | §12 Future: cursor-based paging added next to Tuist. Docs only. |
| 0.10 | 2026-11-25 | Enquiry flow review. `SMTP_TIMEOUT_MS` (default 10000) is applied to the connection, greeting and socket timeouts, and a hung send → 502. The transport is built via `smtpTransportOptions(config)` and an injectable factory. Precise SES settings (587 + `SMTP_SECURE=false` with STARTTLS, or 465 + `SMTP_SECURE=true`). `productId` must be a positive integer JSON number (§6.9, §7.5). Tests added for no customer data in failure logs, control characters, productId shapes and the SMTP timeout. |
| 0.11 | 2026-11-26 | Logger review. New §5.11 "Log events" lists every event, its level and its context. Debug events added: `config.loaded` (safe allowlisted summary), `cache.hit` / `cache.miss` / `cache.stale`, `upstream.request`, `image.fetched`, `search.executed`, `email.sending` / `email.sent`. `TtlCache` receives `name` + `Logger`; the repository, `SmtpEmailService` and the products route receive an injected `Clock` (`ports/Clock.ts`, `AppDeps.now`). Rules: debug only, no customer data or secrets, durations from the injected clock. |
| 0.12 | 2026-11-26 | Container test seams documented in §5.3: `now` override (default `performance.now()`) and `Container.whenIdle()`. §9 states that tests never sleep. The end-to-end logging test uses a fake clock and `whenIdle()` instead of real sleeps. |
