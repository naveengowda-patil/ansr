# Product Catalogue — Blueprint

| | |
|---|---|
| Status | v0.21, backend implemented, iOS foundation and Home built (phase 2.1) |
| Last updated | 2026-11-26 |
| Rules | [`CLAUDE.md`](../CLAUDE.md) (how to write code) |
| Decisions log | [`DECISIONS.md`](../DECISIONS.md) (why) |
| Architecture guides | [BACKEND_ARCHITECTURE.md](BACKEND_ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md), [FRONTEND_ARCHITECTURE.md](FRONTEND_ARCHITECTURE.md) |

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

**Out of scope (for now):** authentication, cart/checkout, persistence/database, search sort/filter UI, search pagination UI, rate limiting, analytics, localisation, accessibility work (D-041), iPad-specific layouts, deployment pipelines.

## 2. Acceptance criteria

| ID | Criterion | Exact rule |
|---|---|---|
| AC-1 | **Home** shows 5 featured "top rated" products the business picked | Ordered list `FEATURED_PRODUCT_IDS` from config. Ids that don't exist are skipped. If fewer than 5 remain, fill up with the highest-rated products not already included (ranking §5.5). Max 5 products. |
| AC-2 | **Categories**: open a category, see its top rated products first, then the rest | Category names match case-insensitively (§6.8). Top rated = the 3 highest-rated products in that category (§5.5). Rest = the remaining products of the category in upstream order. No duplicates. A category with ≤3 products has an empty `rest`. |
| AC-3 | **Search**: type a term, tap search, only see matching products | Runs on explicit submit only. Case-insensitive substring match of the trimmed term on title, description **or** category. Filtering happens in the backend. |
| AC-4 | **Product details**: tap a tile to see details | Detail screen fetches the product by id. |
| AC-5 | **Enquiry**: tap "Enquire", fill a short form, submit; sales inbox gets an email, customer sees "Thank you" | Fields `productId`, `name`, `email` required, `message` optional. Plain-text email to `SALES_INBOX_EMAIL` with `Reply-To` = customer. On success the sheet shows a thank-you state. |

## 3. Constraints

- **Under 10 minutes to run locally** for someone new: backend with one command, `docker compose up --build`, from a fresh clone, app on the iOS Simulator against the local backend (§8).
- **No paid services or accounts.** Emails are caught locally by Mailpit.
- **No secrets in the repo.** Config comes from `.env.example`, which holds safe local defaults and is used directly. An optional `.env` (git-ignored) overrides it.
- **AWS friendly** infra: containerised, stateless, config from env, logs to stdout, health endpoint (§8.3).
- **The iOS app only talks to our backend.** It never calls `fakestoreapi.com`, not even for images.
- **Tests cover the critical path** (§9) so the code can be changed with confidence.

## 4. Architecture overview

```
 iOS app (SwiftUI, MVVM-C)                         Backend (Node.js, Express, TypeScript)              External
┌──────────────────────────────┐                ┌──────────────────────────────────────────┐
│ View → ViewModel → Repository│   HTTP/JSON    │ routes → ports (interfaces) ← adapters   │
│     protocol → NetworkClient ├──────────────▶│   │         ProductRepository ──────────┼──▶ fakestoreapi.com
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
├── docs/             # BLUEPRINT.md + reader guides
├── backend/          # Node.js + TypeScript API
└── iOS/ANSR/         # SwiftUI app (ANSR.xcodeproj, §7.2)
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
│       └── TtlCache.ts          # TTL cache: stale-while-revalidate (expired copy served while one background refresh runs), retry back-off, 24 h stale cap, single-flight, injected clock
├── test/
│   ├── fixtures/fakestore/      # products.json, recorded from GET /products (image tests use inline bytes)
│   ├── support/
│   │   ├── fakes.ts             # in-memory port fakes, recording logger, buildProduct
│   │   ├── testApp.ts           # createApp wired with the fakes
│   │   └── fakeStore.ts         # fake Fake Store responses (fixture, fake fetch, fake clock) for the real repository
│   ├── domain/                  # pure business rules
│   ├── lib/                     # TtlCache
│   ├── adapters/                # Fake Store repository, search engine, SMTP email, JSON logger
│   ├── routes/                  # Supertest, per resource + search plug-and-play + errors
│   ├── config.test.ts
│   ├── container.test.ts
│   ├── logging.test.ts          # debug events end to end through createContainer
│   └── startup.test.ts
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
- **Enquiry email** — `buildEnquiryEmail(product, enquiry, settings, receivedAt) → EmailMessage` (§5.8). The route passes `receivedAt` (`new Date()`), so the function stays pure and tests get an exact timestamp.

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

Read and validated only in `src/config.ts`. The app fails fast at startup on invalid config and lists every problem. All variables are in the root `.env.example` with safe local values. Docker Compose uses that file directly as the defaults, so it must stay free of secrets and always runnable as-is.

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

Section numbers 7.1–7.9 keep their earlier topics. 7.10 and 7.11 were added in v0.18.

### 7.1 Stack and project setup

Why this stack: D-025. Why these settings: D-039.

| Setting | Value |
|---|---|
| Project | `iOS/ANSR/ANSR.xcodeproj`, with synchronized folder groups (Xcode 16+), so files added to a folder are picked up without editing the project file. No project generator. |
| Targets | `ANSR` (the app) and `ANSRTests` (unit tests). **No UI test target.** |
| Deployment target | **iOS 18.0** (D-013), **iPhone only** (`TARGETED_DEVICE_FAMILY = 1` on both targets, no iPad orientation keys) |
| Language | **Swift 6** language mode, strict concurrency checking `complete` |
| Default actor isolation | **`nonisolated`**. UI types are marked `@MainActor` explicitly: views, view models, `AppCoordinator`, `AppBootstrapper` and the UIKit delegates. |
| Approachable Concurrency | **Off** (`SWIFT_APPROACHABLE_CONCURRENCY = NO`), with no upcoming-feature flags. A `nonisolated` `async` function runs off the main actor, so JSON decoding and image work never run on the main actor by accident. |
| Signing | No development team. **Simulator only**, so no Apple developer account is needed. |
| Dependencies | **None**: no Swift packages, no third-party code |
| Tests | **Swift Testing** (`import Testing`). No XCTest, no UI or snapshot tests (§9.2). |
| Tooling | Requires **Xcode 16 or newer**. Built and tested with Xcode 26. |
| Build configurations | **Debug** and **Prod** (no Release), each based on its xcconfig in `Config/` (§7.7). |

- Swift Concurrency only (`async`/`await`). No completion handlers, no Combine.
- **xcconfig URLs** are written `http:/$()/localhost:3000`, because `//` starts a comment in an xcconfig. The empty `$()` disappears when the setting resolves, giving `http://localhost:3000`.

**How `Info.plist` is wired** (D-042):

| Setting | Value | Why |
|---|---|---|
| `INFOPLIST_FILE` | `ANSR/Info.plist` | The app's own keys live in one file. |
| `GENERATE_INFOPLIST_FILE` | `YES` (kept) | Xcode still generates the standard keys (bundle, launch screen, orientations) and merges `ANSR/Info.plist` into them. |
| `INFOPLIST_KEY_UIApplicationSceneManifest_Generation` | `NO` | The scene manifest comes from `ANSR/Info.plist`, so it can name `SceneDelegate`. |
| Membership exception | `Info.plist` excluded from the `ANSR` target on the synchronized `ANSR/` folder | Otherwise the file would also be copied into the app as a resource. |
| `INFOPLIST_PREPROCESS` | `YES` (both configurations) | Lets one file carry a Debug-only key (below). |
| `INFOPLIST_PREPROCESSOR_DEFINITIONS` | `ANSR_ALLOW_LOCAL_NETWORKING=1` in the **Debug** target settings only | Prod never defines it, so Prod never gets the exception. It sits in the target's build settings rather than the xcconfig, which keep only the values §7.7 lists. |

Keys in `ANSR/Info.plist`:
- `API_BASE_URL = $(API_BASE_URL)` and `REQUEST_TIMEOUT_SECONDS = $(REQUEST_TIMEOUT_SECONDS)`, read only by `AppConfiguration` (§7.7).
- `UIApplicationSceneManifest`: one scene, no multiple scenes, `UISceneDelegateClassName = $(PRODUCT_MODULE_NAME).SceneDelegate`.
- `NSAppTransportSecurity` → `NSAllowsLocalNetworking = true`, wrapped in `#if ANSR_ALLOW_LOCAL_NETWORKING … #endif`. The `#if` lines sit inside XML comments, so the file on disk stays a valid plist (`plutil -lint` passes), and the preprocessor drops the block in Prod.
- Check with `plutil -p <built app>/Info.plist`: the Debug app has `NSAppTransportSecurity`, and the Prod app has no `NSAppTransportSecurity` key at all.

### 7.2 Structure

```
iOS/ANSR/
├── ANSR.xcodeproj               # shared schemes in xcshareddata/xcschemes: "ANSR Debug", "ANSR Prod" (§7.7)
├── Config/
│   ├── Debug.xcconfig           # API_BASE_URL (local backend), REQUEST_TIMEOUT_SECONDS
│   └── Prod.xcconfig            # API_BASE_URL (placeholder), REQUEST_TIMEOUT_SECONDS
├── ANSR/                        # app target
│   ├── Info.plist               # API_BASE_URL, REQUEST_TIMEOUT_SECONDS, scene manifest (excluded from resources)
│   ├── App/                     # AppDelegate (@main), SceneDelegate, AppBootstrapper, AppConfiguration,
│   │                            # AppDependencies, ConfigurationErrorView
│   ├── Navigation/              # AppCoordinator, CoordinatorView, Route, Sheet, the five *Navigating protocols (Navigating.swift)
│   ├── Networking/              # NetworkClient, URLSessionNetworkClient, Endpoint, Endpoints, APIError, ErrorEnvelope
│   ├── Models/                  # API data models: Product, Rating, CategoryProducts, ProductPage, ProductQuery,
│   │                            # EnquiryRequest, EnquiryResponse, ItemsResponse
│   ├── Repositories/            # ProductRepository, CategoryRepository, EnquiryRepository + Remote… of each
│   ├── Images/                  # ImageProvider, HybridImageProvider
│   ├── Features/
│   │   └── Home/  Category/  SearchResults/  ProductDetail/  Enquiry/
│   │                            # per screen: View, ViewModel, ViewData + its pure mapping functions
│   ├── Shared/                  # ViewState, StateContainerView, ProductTileView, ProductTileViewData,
│   │                            # ProductImageState, ProductImageLoader, ErrorMessages, Formatters, Strings
│   ├── Theme/                   # AppTheme tokens + environment key
│   └── Mocks/                   # AppDependencies.mock, mock repositories, MockImageProvider, MockData (#if DEBUG)
└── ANSRTests/                   # Swift Testing suites; Support/ holds test doubles such as StubURLProtocol (§9.2)
```

### 7.3 MVVM-C layering and models

The direction is strict, and no layer skips another or calls upwards:

```
View → ViewModel → repository protocol → Remote…Repository → NetworkClient → URLSessionNetworkClient → backend
                 → ImageProvider → HybridImageProvider → NetworkClient (on a cache miss, §7.6)
```

- **Views are dumb.**
  - They render view data and call view model intents. Nothing else.
  - No networking, formatting, validation or navigation decisions.
  - Every state change is driven by the view model, search text and form fields included. Bindings point at view model state.
  - The only state a view may own is `@FocusState`.
  - Each screen view holds its view model in `@State`, created by the coordinator and passed in (`_viewModel = State(initialValue:)`). A view model's `init` does no work, so rebuilding a view is cheap.
- **View models** are `@MainActor @Observable final class`.
  - Through `init` they receive the repository protocols they use, `ImageProvider`, their navigator (held `weak`) and the `Locale` used for formatting.
  - They expose a `ViewState` of view data (§7.11) and intents such as `load()`, `retry()` and taps.
  - They never touch `URLSession`, `AppCoordinator`, `Route` or other screens.
- **Two model layers** (D-031):

| Layer | Types | Lives in | Rule |
|---|---|---|---|
| **Data models** | `Product`, `Rating`, `CategoryProducts`, `ProductPage`, `ProductQuery`, `EnquiryRequest`, `EnquiryResponse`, `ItemsResponse<Item>` | `Models/` | Match the API (§6) field for field. `Codable` as needed, `Sendable`, `Equatable`. No formatting. `price` is a `Decimal`. |
| **View data** | One set per screen, e.g. `ProductTileViewData { id, title, priceText, ratingText }` | `Features/<Screen>/`, except `ProductTileViewData`, which every tile shares, in `Shared/` | Exactly what the screen renders, already formatted as text. `Equatable`. |

- **Mapping:** view models turn data models into view data with **pure functions** (model + `Locale` in, view data out), defined next to the view data.
- **View data per screen:**
  - `ProductTileViewData { id, title, priceText, ratingText }`, shared by every tile.
  - `CategoryRowViewData { name, title }`. `name` is spelled as in the data and used for navigation. `title` is capitalised for display.
  - `HomeViewData { featured: [ProductTileViewData], categories: [CategoryRowViewData] }`
  - `CategoryViewData { title, topRated: [ProductTileViewData], moreTitle, rest: [ProductTileViewData] }`
  - `SearchResultsViewData { summary, results: [ProductTileViewData] }`
  - `ProductDetailViewData { id, title, priceText, ratingText, categoryText, description }`
- **Naming:** a protocol is named for its **role**, and a concrete type for **how** it does the job.
  - `NetworkClient` / `URLSessionNetworkClient`
  - `ProductRepository` / `RemoteProductRepository`
  - `ImageProvider` / `HybridImageProvider`
  - D-033.

### 7.4 Coordinator and navigation

- **One `AppCoordinator`** (`@MainActor @Observable final class`) owns all navigation state. No child coordinators (D-026), no tab bar (D-021).
  - `private(set) var path: [Route]`
  - `private(set) var sheet: Sheet?`
- **One `NavigationStack(path:)`** rooted at Home, with `.navigationDestination(for: Route.self)` and `.sheet(item:)`.
- **It is the only place that builds view models and views**, from `AppDependencies` (§7.7), using private factory methods:
  - `makeHome()`
  - `makeCategory(name:)`
  - `makeSearchResults(query:)`
  - `makeProductDetail(id:)`
  - `makeEnquiry(productId:productTitle:)`

  Its one public view entry is `rootView()`, which `SceneDelegate` hosts.
- **`CoordinatorView`** is the navigation shell that `rootView()` returns. It holds the `NavigationStack(path:)`, `.navigationDestination(for:)`, `.sheet(item:)` and the theme, and owns no state: the coordinator hands it the two bindings and closures that call its private factories.

```swift
enum Route: Hashable {
    case category(name: String)
    case product(id: Int)
    case searchResults(query: String)
}

enum Sheet: Identifiable, Hashable {
    case enquiry(productId: Int, productTitle: String)
    var id: Self { self }
}
```

**One navigator protocol per view model**, with only what that view model needs (D-032). `AppCoordinator` conforms to all five.

```swift
@MainActor protocol HomeNavigating: AnyObject {
    func showProduct(id: Int)
    func showCategory(name: String)
    func showSearchResults(query: String)
}
@MainActor protocol CategoryNavigating: AnyObject {
    func showProduct(id: Int)
}
@MainActor protocol SearchResultsNavigating: AnyObject {
    func showProduct(id: Int)
    func showSearchResults(query: String)
}
@MainActor protocol ProductDetailNavigating: AnyObject {
    func showEnquiry(productId: Int, productTitle: String)
}
@MainActor protocol EnquiryNavigating: AnyObject {
    func dismissSheet()
}
```

**Thin entry points.** Each protocol method only forwards to one private function in the same file:

| Entry point | Forwards to |
|---|---|
| `showProduct(id:)` | `push(.product(id:))` |
| `showCategory(name:)` | `push(.category(name:))` |
| `showSearchResults(query:)` | `push(.searchResults(query:))` |
| `showEnquiry(productId:productTitle:)` | `present(.enquiry(productId:productTitle:))` |
| `dismissSheet()` | `dismissPresented()` |

- **Only the private functions write `path` and `sheet`:**
  - The `NavigationStack` gets a binding whose setter calls the private `pop(to:)` when the system shortens the path (Back button or back-swipe). A setter value that isn't a shorter prefix of the current path is ignored, so the binding can never push or replace a screen.
  - The sheet binding's setter calls `dismissPresented()` when the system clears it (swipe down).
  - The two bindings (`pathBinding`, `sheetBinding`) are **internal, not private**, so tests can drive them the way the system does. They can still only pop and dismiss.
  - Checked at runtime in phase 2.1: Back button and back-swipe both reach `pop(to:)`, the stack stays in step with `path`, and Home keeps its content. No change to the binding was needed.
- **View models hold their navigator `weak`.** They never reference `AppCoordinator` or `Route`.
- **Not used:** `NavigationLink(destination:)`, `NavigationLink(value:)`, `isPresented` flags, and navigation state in views or view models. Navigation is always view model intent → navigator → coordinator.
- **Search** pushes a new `.searchResults` screen on every submit, so Back returns to the previous search (D-037).
- **No deep links** for now (§12).

### 7.5 Networking

- **All HTTP goes through `NetworkClient`**, images included.
  - Only `URLSessionNetworkClient` uses `URLSession`, `URLRequest` or `JSONDecoder` for network calls.
  - Requests are `Endpoint` values (method, path, query items, body), built in `Endpoints.swift`.
  - URLs are built with `URLComponents` and `URLQueryItem`, never by joining strings.
  - Each path segment is percent-encoded on its own, so a `/` inside a category name can't split the path. Query values also encode `+`, `&`, `=`, `?`, `#` and `/`, so `c++` reaches the backend as `c++`, not `c  `.
  - The JSON body is an `Encodable` value on the `Endpoint`, encoded by the client. `Accept: application/json` is sent for JSON requests only, not for image bytes.
- **The session** is created once in the composition root (§7.7):
  - `timeoutIntervalForRequest` = `REQUEST_TIMEOUT_SECONDS`;
  - **`waitsForConnectivity = false`**, so offline fails fast as `.offline`;
  - **`urlCache = nil`**, because images are cached once, in `HybridImageProvider` (§7.6).

```swift
protocol NetworkClient: Sendable {
    func send<Response: Decodable & Sendable>(_ endpoint: Endpoint, as type: Response.Type) async throws(APIError) -> Response
    func data(for endpoint: Endpoint) async throws(APIError) -> Data   // raw bytes, for images
}
```

| Endpoint | Request |
|---|---|
| `featured` | `GET /products/featured` |
| `products(ProductQuery)` | `GET /products` with only the non-empty query fields |
| `product(id:)` | `GET /products/{id}` |
| `productImage(id:)` | `GET /products/{id}/image` |
| `categories` | `GET /categories` |
| `category(name:)` | `GET /categories/{category}`, path-encoded |
| `createEnquiry(EnquiryRequest)` | `POST /enquiries`. `EnquiryRequest.productId` is a Swift `Int`, so it is encoded as a positive integer JSON number (`7`, never `"7"` or `7.5`). The backend returns 400 for anything else (§6.9). |

- **`ProductQuery`** mirrors §6.4, with every field optional (`q`, `category`, `minPrice`, `maxPrice`, `minRating`, `sort`, `page`, `pageSize`).
  - The search screen sends `q` only, trimmed (text search only, D-008).
  - `page` and `pageSize` are left out, so the backend defaults apply (D-024).
- **`Endpoint` and `Endpoints` never send empty values.**
  - A `nil` field is omitted, and so is a string that is empty after trimming.
  - The backend rejects present-but-empty params with 400 (§6.4), so the app never produces `?q=` or `?category=`.
  - In the enquiry body, a blank `message` is omitted.

`APIError` is typed and `Equatable`:

| Case | From |
|---|---|
| `.validation(message:)` | 400 `VALIDATION_ERROR` |
| `.notFound` | 404 `NOT_FOUND` |
| `.upstream` | 502 `UPSTREAM_ERROR` |
| `.server(status:)` | 500 `INTERNAL_ERROR`, or any other non-2xx or unknown envelope. The status and the envelope code must agree: a 404 whose body isn't the `NOT_FOUND` envelope is `.server(status: 404)`. |
| `.offline` | `URLError` not connected or connection lost |
| `.timeout` | `URLError.timedOut` |
| `.cancelled` | `URLError.cancelled` or `CancellationError`. The screen was left. Never shown, and view models ignore it. |
| `.decoding` | The response body doesn't decode |
| `.transport` | Any other `URLError` |

**`ErrorMessages`** is one pure function, `message(for: APIError) -> String`, that turns an error into user-facing text. The text lives in `Strings` (§7.9), and raw errors are never shown.

| Error | Message |
|---|---|
| `.offline` | "You're offline. Check your connection and try again." |
| `.timeout` | "The server took too long to respond. Please try again." |
| `.upstream` | "We can't reach the catalogue right now. Please try again in a moment." |
| `.validation` | "Please check your details and try again." |
| `.notFound` | "This item is no longer available." This only shows where a screen doesn't treat 404 as empty (§7.8). |
| `.server`, `.decoding`, `.transport` | "Something went wrong. Please try again." |

### 7.6 Images (`HybridImageProvider`)

```swift
protocol ImageProvider: Sendable {
    func image(forProductId id: Int) async throws -> UIImage
}
```

**`HybridImageProvider`** is an `actor`, and `image(forProductId:)` is its only public function. Everything else is private (D-034).

- **Built by the composition root** (§7.7) with:
  - the `NetworkClient`;
  - the cache folder (`Caches/ProductImages/`);
  - a `NotificationCenter`;
  - its limits: about **100** images in memory, **50 MB** on disk, and a short disk-write delay.
- **Lookup:** memory → disk → network.
  - A disk hit is also put in memory.
  - A downloaded image goes to memory at once, and to disk shortly after (below).
  - Network fetches use `Endpoints.productImage(id:)` through `NetworkClient.data(for:)`. Bytes that don't decode to an image throw `ImageProviderError.undecodableImage`.
- **One download per image:** two requests for the same id share one in-flight `Task`.
- **Memory:** an `NSCache` with `countLimit = 100`. It's "about 100" because `NSCache` may evict earlier under memory pressure.
- **Launch preload:**
  - At launch, a background task loads the persisted images into memory, newest first, up to the memory limit.
  - It yields between files, so `image(forProductId:)` calls are served meanwhile. Home is never delayed by it.
- **Writing to disk:**
  - Each downloaded image is written shortly after download, with pending writes batched.
  - Anything still pending is flushed when the app goes to the background (`UIApplication.didEnterBackgroundNotification`). The provider subscribes to it privately when it starts, through `NotificationCenter.notifications(named:)` in a task it cancels on `deinit`, so the single public function stays the only one.
  - The composition root sets the write delay to **2 seconds**.
  - **The background flush runs inside a `UIApplication` background task** (`beginBackgroundTask` / `endBackgroundTask`), so iOS gives it time to finish before suspending the app. The task ends when the flush completes, or from the expiration handler if time runs out first. This is private; `image(forProductId:)` stays the only public function. The provider receives the `UIApplication` from the composition root.
  - Nothing relies on an exit callback, because iOS often terminates suspended apps without one.
- **Disk:**
  - One file per product id in `Caches/ProductImages/`, holding the bytes as received.
  - Capped at about **50 MB**. When a write takes it over the cap, the oldest files (by modification date) are removed first.
  - **No expiry.** iOS may also purge the Caches folder at any time.
- **Errors:** disk problems are never fatal. A failed read counts as a miss, and a failed write is dropped. Network errors are rethrown.

**Tile images are driven by the view model** (D-022):
- Each view model that shows images owns a `ProductImageLoader` (`@MainActor @Observable`), which calls `ImageProvider` and keeps one `ProductImageState` per product id: `loading`, `loaded(UIImage)` or `failed`.
- The view reports that a tile appeared (`viewModel.tileAppeared(id:)`) from the tile's `.task`, so the request is cancelled if the tile goes away first. It renders `viewModel.imageState(for:)` as a placeholder, the image, or a "failed" icon.
- Each id is requested once per screen. A request cancelled because its tile went away is forgotten, so the next appearance asks again.
- The product detail image works the same way.

### 7.7 Launch, configuration and DI

**Launch.** The app uses the UIKit lifecycle and hosts SwiftUI (D-030):

1. **`@main final class AppDelegate`** does nothing beyond the default scene setup. `Info.plist`'s `UIApplicationSceneManifest` names `SceneDelegate`.
2. **`SceneDelegate.scene(_:willConnectTo:options:)`** creates the window and calls `AppBootstrapper.configure()`.
3. **`AppBootstrapper`** (`@MainActor`) is its own type, so it can be tested. `configure()`:
   1. loads `AppConfiguration` from the info dictionary it was given;
   2. builds `AppDependencies.live(configuration)`;
   3. builds `AppCoordinator(dependencies:)`.

   It returns `.ready(AppCoordinator)` or `.configurationError(message)`.
4. **On success**, the window's root is a `UIHostingController` with `coordinator.rootView()`: Home, with the theme injected. **On failure**, the root is a `UIHostingController` with `ConfigurationErrorView`. `SceneDelegate` keeps the coordinator alive.

- **No network calls before the UI.** The bootstrapper only reads `Info.plist` and builds objects.
- **Hosting tests** (D-043): the bootstrapper also receives the process environment. When `XCTestConfigurationFilePath` is set (Xcode sets it in an app that hosts a test bundle), `configure()` returns `.hostingTests`, nothing is built, and the window shows an empty view controller. So a test run never loads Home, never calls the backend and never touches the image cache.
- **No splash.** Home's spinner is the launch state.
- **No refresh** when the app comes back from the background (§12).

**Configuration.**
- **`AppConfiguration { apiBaseURL: URL, requestTimeout: TimeInterval }`** is built once, from `Info.plist`:
  - `API_BASE_URL = $(API_BASE_URL)`
  - `REQUEST_TIMEOUT_SECONDS = $(REQUEST_TIMEOUT_SECONDS)`
- It is the only code that reads those values. There's no URL or timeout in Swift source.
- A missing or invalid value makes it throw, naming the `Info.plist` key:
  - the URL isn't absolute `http`/`https` with a host;
  - or the timeout isn't a positive number.

  The bootstrapper turns that into `.configurationError(message)`, where the message names the key (a build setting name, never a value or a secret).

**Build configurations and schemes** (D-039):

| Configuration | Shared scheme | xcconfig | `API_BASE_URL` | `REQUEST_TIMEOUT_SECONDS` | Plain HTTP |
|---|---|---|---|---|---|
| **Debug** | `ANSR Debug` | `Config/Debug.xcconfig` | `http://localhost:3000` | `15` | Allowed to `localhost` only: `NSAllowsLocalNetworking` |
| **Prod** | `ANSR Prod` | `Config/Prod.xcconfig` | `https://api.example.com` (a placeholder until real environments exist) | `15` | None. HTTPS only, no ATS exception. |

- **Prod** replaces the template's Release configuration. It is optimised and has no `DEBUG` flag.
- **Schemes:** both are shared (`xcshareddata`), so a fresh clone has them.
  - Run and Archive use the scheme's own configuration.
  - Test uses Debug in both, since tests use test doubles and never the URL.
- **xcconfig syntax:** `//` starts a comment in an xcconfig, so URLs are written as `http:/$()/localhost:3000`.
- **Checking ATS:** the local-networking exception exists only in the Debug build. Check this by running `plutil -p` on each built app's `Info.plist`.
- **Signing:** no `DEVELOPMENT_TEAM`, simulator only.

**Dependency injection.**
- **`AppDependencies`** exposes **protocols only**:
  - `productRepository`, `categoryRepository`, `enquiryRepository` and `imageProvider`;
  - plus `theme: AppTheme` and `locale: Locale`.
- **`AppDependencies.live(_:)`** is the **composition root**: the only place concrete types are created. It is `@MainActor`, because it hands `UIApplication.shared` to `HybridImageProvider`.
  - `URLSession`, `URLSessionNetworkClient` and the `Remote…Repository` types.
  - `HybridImageProvider`, with its limits.
  - The standard `AppTheme`.
- **`AppDependencies.mock`** (Debug only) uses mock repositories for previews.
- **The coordinator** gets `AppDependencies` and passes each view model only the protocols it needs (§7.10). Views never reach for dependencies themselves.
- **Previews** use the real view model with mock repositories (D-014).
- **Tests** build view models directly with test doubles, never the live client (§9.2).

### 7.8 Screens

| Screen | Route | View model | Data | Empty state | Intents |
|---|---|---|---|---|---|
| **Home** (root) | none (root) | `HomeViewModel` | `featured()` and `categories()` in parallel → `ViewState<HomeViewData>` | Both lists empty: "No products to show right now." | tile → `showProduct`; category row → `showCategory`; search submit → `showSearchResults` |
| **Category** | `.category(name:)` | `CategoryViewModel` | `category(name)` → `ViewState<CategoryViewData>` | 404: "This category is no longer available." | tile → `showProduct` |
| **Search results** | `.searchResults(query:)` | `SearchResultsViewModel` | `search(ProductQuery(q:))` → `ViewState<SearchResultsViewData>` | No results: "No products match '{q}'." | search submit → `showSearchResults`; tile → `showProduct` |
| **Product detail** | `.product(id:)` | `ProductDetailViewModel` | `product(id:)` → `ViewState<ProductDetailViewData>` | 404: "This product is no longer available." | Enquire → `showEnquiry` |
| **Enquiry** (sheet) | `Sheet.enquiry` | `EnquiryViewModel` | `submit(EnquiryRequest)` | none: it's a form (§7.8.5) | submit; Done → `dismissSheet` |

**Built so far (phase 2.1):** Home is real. Until each of the other screens lands, `makeDestination(for:)` and `makeSheet(for:)` show a `RoutePlaceholderView` that names what opened it ("Product 5", "Category jewelery", "Search: ring", "Enquiry for product 5"), so navigation can be checked at runtime. Each placeholder is replaced by its screen's factory (`makeCategory(name:)` and so on).

Every screen except Enquiry uses the states and loading rules in §7.11. Any error other than the 404s above shows the error state with Retry.

**The search field** is the same on Home and Search results:
- It is always visible: `.searchable(text:placement: .navigationBarDrawer(displayMode: .always))`, with the prompt "Search products". The text lives in the view model.
- It submits with `.onSubmit(of: .search)` and passes the trimmed text.
- **Search is disabled while the trimmed text is empty:**
  - The keyboard's Search key is disabled while the field is empty, which is the system default.
  - The view model's `canSearch` is `false` for whitespace-only text, so a submit then does nothing: no navigation and no request.

#### 7.8.1 Home

Layout: D-035.

- **Title:** a large navigation title, "Catalogue".
- **Search field:** always visible (above).
- **"Top rated":** the 5 featured products (AC-1), in API order, as a horizontal row of tiles.
- **"Categories":** one row per category, with a chevron.
  - The row shows the name capitalised.
  - A tap opens the category by its name as the data spells it.
- **No "all products" section.**
- **Loading:**
  - `featured()` and `categories()` run in parallel. The screen is loaded once both succeed.
  - **If either fails, the whole screen shows the error with Retry** (D-036). There are no partial results.
  - If one list is empty, its section is hidden. If both are empty, the screen shows the empty state.

#### 7.8.2 Category

- **Title:** the category name, capitalised.
- **"Top rated":** `topRated` (up to 3), as a horizontal row of tiles, in API order (AC-2).
- **"More in {Category}":** `rest`, as a 2-column grid, in API order. **The section is hidden when `rest` is empty.**
- **404** shows the empty state "This category is no longer available."

#### 7.8.3 Search results

- **Search field:** prefilled with the query.
- **Request:** `search(ProductQuery(q: query))`. Only `q` is sent, because the app does text search only (§6.4, D-008).
- **Loaded state:**
  - A summary: "{n} results for '{q}'", or "1 result for '{q}'" when `n` is 1. `n` is `total`.
  - Below it, a 2-column grid of exactly the returned products, in API order.
- **Empty** (`total` is 0): "No products match '{q}'."
- **Searching again** pushes a **new** results screen, and Back returns to the previous one (D-037).

#### 7.8.4 Product detail

- **Fetching:** the product is fetched by id (D-012).
- **Layout,** in a scroll view:
  - a large image (§7.6);
  - title, price and rating;
  - category, capitalised;
  - description.
- **"Enquire"** is pinned at the bottom (a bottom safe-area inset) and shows only in the loaded state. It calls `showEnquiry(productId:productTitle:)`.
- **404** shows the empty state "This product is no longer available." (D-024).

#### 7.8.5 Enquiry sheet

- **Presentation:** a sheet over Product detail. It shows the product title and three fields: name, email (email keyboard, no autocorrection or autocapitalisation) and message (multi-line, optional).
- **Field values live in the view model.**
- **Validation mirrors §6.9.** The backend stays the final judge.

| Field | Rule |
|---|---|
| `name` | Required. Trimmed, 1–100 characters, no line breaks. |
| `email` | Required. Trimmed, a valid email shape (`local@domain.tld`, no spaces), at most 254 characters. |
| `message` | Optional. At most 2000 characters, line breaks allowed. Omitted from the request when blank. |
| `productId` | A Swift `Int` taken from the sheet, sent as a JSON number (§7.5). |

- **Submit** is enabled only while the form is valid and not submitting. Invalid input never sends a request.
- **States:** `editing` → `submitting` → `submitted` or `failed(message)` (D-038):

| State | Shows |
|---|---|
| `editing` | The form. Submit is enabled when the form is valid. |
| `submitting` | The form disabled, with progress on Submit. **Swipe-to-dismiss is blocked** (`interactiveDismissDisabled`). |
| `submitted` | The thank-you message: "Thank you, {name}. Our sales team will reply to {email} soon." It uses the trimmed values. **Done** calls `dismissSheet()`. |
| `failed(message)` | The form, **with everything the user typed kept**, the message from `ErrorMessages`, and Submit enabled again. |

### 7.9 Theme, text and formatting

- **`AppTheme`** holds every colour, font, spacing value, corner radius and image size as tokens.
  - Colours are **system semantic colours** (background, secondary background, primary and secondary text, accent, placeholder), so dark mode works.
  - Fonts are system text styles.
  - The theme is a value injected once at the root through a SwiftUI environment key, from `AppDependencies` (D-023).
  - No hardcoded colours, fonts or spacing in views.
- **Text:** all user-facing text lives in one file, `Shared/Strings.swift`.
  - It holds plain constants, plus functions for text with values in it, such as `searchSummary(count:query:)`.
  - English only, with no translations and no String Catalog.
- **Formatting:** pure functions in `Shared/Formatters.swift`. The `Locale` is always passed in, and `Locale.current` is never read inside.
  - **Price** with its currency: `priceText(_:currencyCode:locale:)` gives `$109.95` for `en_US`.
  - **Rating:** `ratingText(_:locale:)` gives `4.5 ★ (120)`, with the rate to one decimal place.
  - **Category names, capitalised:** `categoryTitle(_:locale:)` gives `Men's Clothing`.
- **Accessibility is not required** for the proof of concept (D-041). There are no custom accessibility labels or VoiceOver work. System controls and text styles give the default behaviour.

### 7.10 Repositories

One protocol per repository, each named for its role. `Remote…Repository` structs hold an `any NetworkClient`. Each method calls one `Endpoint` and unwraps `ItemsResponse` where the API wraps a list. They hold no cache and no UI state (D-033).

```swift
protocol ProductRepository: Sendable {
    func featured() async throws(APIError) -> [Product]
    func search(_ query: ProductQuery) async throws(APIError) -> ProductPage
    func product(id: Int) async throws(APIError) -> Product
}

protocol CategoryRepository: Sendable {
    func categories() async throws(APIError) -> [String]
    func category(_ name: String) async throws(APIError) -> CategoryProducts
}

protocol EnquiryRepository: Sendable {
    func submit(_ enquiry: EnquiryRequest) async throws(APIError) -> EnquiryResponse
}
```

View models get only what they use:

| View model | Repositories and providers | Navigator |
|---|---|---|
| `HomeViewModel` | `ProductRepository`, `CategoryRepository`, `ImageProvider` | `HomeNavigating` |
| `CategoryViewModel` | `CategoryRepository`, `ImageProvider` | `CategoryNavigating` |
| `SearchResultsViewModel` | `ProductRepository`, `ImageProvider` | `SearchResultsNavigating` |
| `ProductDetailViewModel` | `ProductRepository`, `ImageProvider` | `ProductDetailNavigating` |
| `EnquiryViewModel` | `EnquiryRepository` | `EnquiryNavigating` |

### 7.11 Screen states and shared UI

```swift
enum ViewState<Value> {
    case loading
    case loaded(Value)
    case empty
    case error(message: String)
}
```

- **There is no idle state:** every screen loads on appear, so a view model starts in `.loading`.
- **`StateContainerView(state:emptyMessage:retry:content:)`** is shared by all screens. It shows:
  - a spinner while loading;
  - the screen's message when empty;
  - the message with a **Retry** button on error;
  - the content when loaded.
- **Loading rules:**
  - **Loading starts in `.task`** (`await viewModel.load()`) and is cancelled automatically when the screen is left. A cancelled load changes nothing on screen (`.cancelled` is ignored).
  - **A second `load()` while one is running is ignored.** So is a `load()` once the screen is loaded or empty, which means going Back to Home doesn't reload it. A load that was cancelled before it finished runs again on the next appearance.
  - **`retry()`** sets `.loading`, so the spinner shows again, and then loads.
- **`ProductTileView`** renders `ProductTileViewData` and an image state (placeholder, image, or "failed" icon). It reports its appearance so the view model can load the image (§7.6).
- **`ConfigurationErrorView`** shows a fixed title and the bootstrapper's message naming the bad key, with no Retry, because configuration is fixed at build time.

---

## 8. Local development and infrastructure

### 8.1 Prerequisites

- Docker with **Compose 2.24 or newer** (Docker Desktop, OrbStack or Colima), needed for the optional `env_file` used below.
- **Xcode 16 or newer** (built with Xcode 26) and an iOS 18+ simulator. No Apple developer account: the app has no development team and runs on the simulator only (§7.7).
- Optional, for running backend tests outside Docker: Node.js 24 (`.nvmrc`).

### 8.2 Run (target: under 10 minutes)

One command from a fresh clone, with nothing to copy:

```bash
docker compose up --build
```

- **Configuration:**
  - `.env.example` is loaded as the defaults.
  - A `.env`, if present, is loaded after it, so any variable it sets wins (`env_file` with `required: false`, D-029).
  - `.env` is optional and only for overrides, for example `PORT=3100` or `LOG_LEVEL=debug`.
  - Compose also reads `.env` for `${PORT}` in the port mapping, so a `PORT` override changes the published port too.
- API: http://localhost:3000 (`/health` to check)
- Mailpit inbox UI: http://localhost:8025 (SMTP on 1025)

**iOS app**, with the backend running:
1. Open `iOS/ANSR/ANSR.xcodeproj`.
2. Choose the **`ANSR Debug`** scheme and an iPhone simulator (iOS 18+).
3. Run (⌘R). Debug already points at `http://localhost:3000`.

The **`ANSR Prod`** scheme uses the placeholder `https://api.example.com` and allows HTTPS only, so it can't reach the local backend. Until a real environment exists it shows Home's error state (§7.7).

`docker-compose.yml` services:
- `api` — built from `backend/Dockerfile`, env from `.env.example` then the optional `.env`, port `${PORT:-3000}`, depends on `mailpit`, healthcheck on `/health`.
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
  - Docker with Compose 2.24 or newer.
  - **Xcode 16 or newer**, which is required for the iOS 18 deployment target and the synchronized-folder project format.
  - An iOS 18+ simulator.
  - Optionally Node.js 24, for backend tests outside Docker.
- **Quick start:** the one command in §8.2 (`.env` optional, for overrides only), and where to see the enquiry email (Mailpit at http://localhost:8025).
- **Running tests:**
  - backend: `cd backend && npm ci && npm test` (Node 24), or with Docker only: `docker build --target test backend`
  - iOS: ⌘U in Xcode with the `ANSR Debug` scheme, or `xcodebuild test -project iOS/ANSR/ANSR.xcodeproj -scheme "ANSR Debug" -destination 'platform=iOS Simulator,name=<an iPhone simulator>'`
- Configuration: a pointer to `.env.example` and §5.10.
- Troubleshooting: ports 3000, 8025 or 1025 already in use; the simulator can't reach the backend because the API isn't running or the `ANSR Prod` scheme is selected.

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
| `config.ts` | Unit | defaults, invalid values fail fast, `FEATURED_PRODUCT_IDS` parsing; several invalid variables at once → **one** `ConfigError` naming every one of them |

### 9.2 iOS (Swift Testing)

The iOS tests cover only what proves AC-1…AC-5, plus the coordinator navigation those flows use (D-040). They are written with Swift Testing in `ANSRTests`.

- **No UI or snapshot tests.**
- **No real network:**
  - View models get recording test doubles of the repository protocols, `ImageProvider` and their navigator.
  - The network client runs on a session with a stub `URLProtocol`.
- **No sleeps:**
  - Tests await the view model's `async` intents directly.
  - An in-between state (`submitting`, or `loading` during a retry) is observed by holding a test double's reply with a continuation until after the assertion. A hold catches only the next call, so a broken "ignore a second load" guard fails a call-count check instead of hanging.

| Area | AC | How | Must cover |
|---|---|---|---|
| `URLSessionNetworkClient` + `Endpoints` | AC-3, and all calls | Stub `URLProtocol` | **Search sends only non-empty params:**<br>• `ProductQuery(q: " bag ")` gives `/products?q=bag`;<br>• `nil` fields and a blank or whitespace `q` are omitted.<br>**Errors map correctly:**<br>• 400 → `.validation`, 404 → `.notFound`, 502 → `.upstream`, 500 or an unknown body → `.server`;<br>• not connected → `.offline`, timed out → `.timeout`, a body that doesn't decode → `.decoding`. |
| `HomeViewModel` | AC-1 (plus the AC-2 and AC-3 entry points) | Mock product and category repositories, mock `ImageProvider`, recording `HomeNavigating` | • `loading` → `loaded` with the 5 featured products as tiles, in API order, with formatted price and rating;<br>• categories capitalised;<br>• either request failing → `error`, then `retry()` → `loading` → `loaded`;<br>• a tile tap → `showProduct(id:)`;<br>• a category tap → `showCategory(name:)` with the data's spelling;<br>• a submit → `showSearchResults(query:)` with trimmed text;<br>• a blank or whitespace submit → no navigation. |
| `CategoryViewModel` | AC-2 | Mock category repository, recording `CategoryNavigating` | • `topRated` first, then `rest`, each in API order;<br>• no "More in" section when `rest` is empty;<br>• 404 → `empty` with "This category is no longer available.";<br>• a tile tap → `showProduct(id:)`. |
| `SearchResultsViewModel` | AC-3 | Mock product repository, recording `SearchResultsNavigating` | • the repository receives a `ProductQuery` with only `q` set to the term;<br>• exactly the returned products are shown, with the "{n} results for '{q}'" summary;<br>• 0 results → `empty` with "No products match '{q}'.";<br>• a new submit → `showSearchResults(query:)`, and a blank one is ignored. |
| `ProductDetailViewModel` | AC-4 | Mock product repository, recording `ProductDetailNavigating` | • it loads `product(id:)` for its id;<br>• it maps title, price, rating, category and description;<br>• 404 → `empty`;<br>• Enquire → `showEnquiry(productId:productTitle:)`. |
| `EnquiryViewModel` | AC-5 | Mock enquiry repository (succeeds, fails or holds), recording `EnquiryNavigating` | **Valid:**<br>• `editing` → `submitting` → `submitted` with the thank-you text;<br>• the request has `productId` as an `Int` and trimmed fields.<br>**Invalid** (blank name, a line break in the name, a bad email, over a length limit):<br>• Submit is disabled and no request is made.<br>**Failure:**<br>• `failed(message)`, every field kept, Submit enabled again.<br>**Done** → `dismissSheet()`. |
| `AppBootstrapper` | All (no network in tests) | The real bootstrapper with a given info dictionary and environment | • the test process carries `XCTestConfigurationFilePath`;<br>• with it set, `configure()` returns `.hostingTests` and builds nothing;<br>• an invalid `API_BASE_URL` gives `.configurationError` naming the key. |
| `AppCoordinator` | Navigation for AC-1…AC-5 | The real coordinator with `AppDependencies.mock` | • `showProduct`, `showCategory` and `showSearchResults` push the right `Route`;<br>• two searches push two screens;<br>• the path binding shortening the path pops;<br>• `showEnquiry` presents the sheet, and `dismissSheet` clears it. |

**Manual walkthrough before the iOS PR:** walk through AC-1…AC-5 by hand on **both schemes** (D-040).
- **`ANSR Debug`:** against the local backend from §8.2, with the enquiry email visible in Mailpit.
- **`ANSR Prod`:** the same walkthrough against a reachable HTTPS backend.
  - Prod's URL is a placeholder until real environments exist, so this part is **blocked** until then.
  - The PR states that it's blocked.

### 9.3 Critical path traceability

| AC | Backend tests | iOS tests |
|---|---|---|
| AC-1 | `selectFeatured`, `GET /products/featured` | `HomeViewModel`, `AppCoordinator` (`showProduct`) |
| AC-2 | `splitTopRated`, `GET /categories`, `GET /categories/{c}` | `HomeViewModel` (category tap), `CategoryViewModel`, `AppCoordinator` (`showCategory`) |
| AC-3 | `matchesText`, engine, `GET /products` | `URLSessionNetworkClient` (non-empty params only), `HomeViewModel` (submit), `SearchResultsViewModel`, `AppCoordinator` (a push per search) |
| AC-4 | `GET /products/{id}`, image route | `ProductDetailViewModel`, `AppCoordinator` (`showProduct`) |
| AC-5 | `buildEnquiryEmail`, `POST /enquiries`, `SmtpEmailService` | `EnquiryViewModel`, `AppCoordinator` (sheet) |

Manual end-to-end check before each PR: run §8.2, walk AC-1…AC-5 in the simulator, see the email in Mailpit. For the iOS PR, do this on both schemes (§9.2).

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
- **iOS, recorded but not built** (D-030, D-035, D-036):
  - **Deep links**, mapped to `Route` values by the coordinator.
  - **Pull-to-refresh** on the screens that load data.
  - **Refresh on foreground** when the app comes back from the background.
  - **Partial Home results:** show whichever of featured or categories loaded, instead of a full-screen error.
  - **A `ScreenFactory`** split out of `AppCoordinator`, so the coordinator only navigates.
  - **Push notification setup** in the `AppDelegate`.
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
| 0.13 | 2026-11-26 | Drift fixes (docs only): §5.2 test tree shows the sub-folders, the top-level test files and `test/support/fakeStore.ts`; §5.5 `buildEnquiryEmail` takes `receivedAt`; "Last updated" set to 2026-11-26. |
| 0.14 | 2026-11-26 | §9.1: a config test proves that one `ConfigError` lists every invalid variable, not just the first. |
| 0.15 | 2026-11-26 | One-command start: Compose loads `.env.example` as defaults and an optional `.env` for overrides, so `docker compose up --build` works from a fresh clone. Needs Compose 2.24+ (§3, §5.10, §8.1, §8.2, §8.4; D-029). |
| 0.16 | 2026-11-26 | Linked the reader guides `BACKEND_ARCHITECTURE.md` and `API_CONTRACT.md` from the header. They explain and link to this blueprint, which stays the single source of truth. |
| 0.17 | 2026-11-26 | Drift fix (docs only): §5.2 describes `TtlCache.ts` as stale-while-revalidate with retry back-off and the 24 h cap, matching the code since v0.7. |
| 0.18 | 2026-11-26 | iOS design (docs only). §7 rewritten:<br>• the project at `iOS/ANSR/ANSR.xcodeproj` with targets `ANSR` and `ANSRTests` (no UI tests), Swift 6 with default isolation `nonisolated` and Approachable Concurrency off, simulator only;<br>• the UIKit lifecycle hosting SwiftUI through `AppBootstrapper`;<br>• Debug and Prod configurations with shared schemes;<br>• dumb views and two model layers (data models and per-screen view data);<br>• repositories named by role and how (`ProductRepository` / `RemoteProductRepository`, and so on), replacing "services";<br>• `HybridImageProvider` (memory → disk → network);<br>• one navigator protocol per view model, with thin coordinator entry points;<br>• the Home, Category, Search results, Product detail and Enquiry screens;<br>• `ViewState` with no idle state;<br>• formatting, `Strings` and theme rules; accessibility out of scope.<br>The §7.8 screens table is fixed, and 7.10 Repositories and 7.11 Screen states are new. §1 out of scope, §4 overview and layout, §8.1, §8.2 and §8.4 iOS run and test steps, §9.2 requirement-linked iOS tests with a manual walkthrough on both schemes, §9.3 iOS column, and §12 iOS future items are all updated. Header links `FRONTEND_ARCHITECTURE.md`. D-030 to D-041. |
| 0.19 | 2026-11-26 | iOS phase 1, the foundation. §7.1 says how `Info.plist` is wired (its own file merged with the generated one, the scene manifest naming `SceneDelegate`, the ATS local-networking exception in Debug only through Info.plist preprocessing, D-042) and how xcconfig URLs are written (`http:/$()/…`). Details settled while building: `CoordinatorView` (§7.4); per-segment path encoding, query encoding of `+&=?#/`, the encodable body and the status-and-code rule (§7.5); `ProductImageState`, `ImageProviderError.undecodableImage`, the 2 s write delay and the cancellable background subscription (§7.6); the configuration error names the bad key (§7.7, §7.11); `ProductTileViewData` lives in `Shared/` (§7.2, §7.3); the phase 1 placeholder Home (§7.8). |
| 0.20 | 2026-11-26 | §7.1: iPhone only is now explicit (`TARGETED_DEVICE_FAMILY = 1` on both targets). The project had iPhone and iPad set, which contradicted §7.1; the project now matches. |
| 0.21 | 2026-11-26 | iOS phase 2.1, Home. §7.4: the path and sheet bindings are internal for tests and can only pop or dismiss; the path binding was checked at runtime and needed no fix. §7.6: the background flush runs inside a `UIApplication` background task, which ends on completion or expiry; tiles report appearance from `.task`, and a cancelled image request is retried on the next appearance. §7.7: `.hostingTests`, so a test run builds nothing and never calls the backend (D-043); `live(_:)` is `@MainActor`. §7.8: route placeholders name the route. §9.2: `AppBootstrapper` tests, and holds catch only the next call. D-034 updated. |
