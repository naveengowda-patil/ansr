# Decisions

Assumptions and trade-offs that fill gaps in the acceptance criteria. The blueprint ([`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)) says *what* is built. This file records *why*.

All entries below were agreed with the product owner on 2026-11-22 and 2026-11-25. Each one links to the blueprint section it shapes. When a decision changes, update the blueprint first, then the entry here.

---

## Product and API

### D-001 — The app reaches product data only through our backend, images included
- **Decision:**
  - The iOS app never calls `fakestoreapi.com`.
  - The backend proxies images at `GET /products/{id}/image`, and the app loads them through `NetworkClient`.
  - Image fetching is `getImage(id)` on `ProductRepository` (resolved OQ-1).
- **Guards on the proxy:**
  - The upstream host must be in `IMAGE_HOST_ALLOWLIST` (default `fakestoreapi.com`).
  - Redirects are not followed.
  - Requests time out after `IMAGE_TIMEOUT_MS`.
  - Only `image/jpeg`, `image/png`, `image/webp` and `image/gif` are passed through, up to `IMAGE_MAX_BYTES`. SVG is rejected because it can carry scripts, and the app can't render it anyway.
  - Responses carry `Cache-Control` and `X-Content-Type-Options: nosniff`.
  - Each guard has its own test.
- **Why:**
  - The data source will change, so the client must not depend on it.
  - The proxy takes a product **id**, never a URL, and only fetches from allowlisted hosts, so it can't be used as an open proxy or for SSRF.
  - `getImage` sits on the repository because images come from the same source as the data, so one adapter swap covers both.
- **Trade-off:** The backend does extra work and holds a bounded cache for image bytes.
- **Blueprint:** §5.4, §5.6, §6.6, §7.6

### D-002 — Home "top rated" is a configured, ordered list
- **Decision:**
  - `FEATURED_PRODUCT_IDS` is an ordered list.
  - Missing ids are skipped.
  - If fewer than 5 remain, the list fills up with the highest-rated products.
  - 5 is a fixed constant. If more than 5 ids are configured, the first 5 that exist are used.
- **Why:**
  - "Picked by the business" means curated, not computed.
  - The fill keeps Home full when picked products disappear upstream.
- **Blueprint:** §2 AC-1, §5.5

### D-003 — Ranking tie-break
- **Decision:** `rating.rate` descending, then `rating.count` descending, then `id` ascending.
- **Why:**
  - The order is deterministic, so tests are stable.
  - More reviews is a sensible second signal.
- **Blueprint:** §5.5

### D-004 — Category view = 3 top rated, then the rest
- **Decision:**
  - Response shape: `{ category, topRated, rest }`.
  - `topRated` holds the 3 highest rated.
  - `rest` holds the remainder in upstream order, with no duplicates. It is empty for a category with 3 or fewer products.
  - An unknown category returns 404.
  - Category names match **case-insensitively** everywhere: `GET /categories/JEWELERY` works, and so does the category filter when it's enabled. The response always spells the category the way the data does (`jewelery`).
- **Why:**
  - Two explicit lists let the app render two sections without re-deriving the rule.
  - Case is not meaningful in a category name. Returning the data's spelling keeps one canonical name for display and links.
  - It is a domain function, not search-engine sorting.
- **Blueprint:** §2 AC-2, §5.5, §6.8

### D-005 — Add `GET /categories`
- **Decision:** A new endpoint that returns the category names.
- **Why:** The app needs the list to let a user "open a category". The acceptance criteria imply it without listing it.
- **Blueprint:** §6.7

### D-006 — Add `GET /health` (liveness only)
- **Decision:** Returns `{ "status": "ok" }` without checking upstream services.
- **Why:**
  - AWS target groups and App Runner need a health check.
  - Checking Fake Store there would get healthy instances replaced during an upstream outage.
- **Blueprint:** §6.2, §8.3

### D-007 — Search matching
- **Decision:**
  - The term is trimmed.
  - It matches as a case-insensitive substring of the whole phrase in the title, description **or category**.
  - A blank `q` that is present returns 400.
  - Filtering happens in the backend, and search runs on submit only.
- **Why:**
  - It's the simplest rule that meets AC-3.
  - Including category means searching "jewel" finds the jewellery category.
  - Tokenised or fuzzy matching belongs to a future engine (D-008).
- **Blueprint:** §2 AC-3, §5.5, §6.4

### D-008 — Search is a swappable engine behind a capability contract
- **Decision:**
  - `ProductRepository` is the source of truth. `ProductSearchEngine` returns only `{ ids, total }`.
  - `GET /products` accepts the full query (`q`, `category`, `minPrice`, `maxPrice`, `minRating`, `sort`, paging).
  - Each engine declares its capabilities. Anything a request uses that the engine doesn't support gets:
    - a 400 `VALIDATION_ERROR` naming it, and
    - a warning in the logs (param, value, engine name) through the injected logger.
  - **The running app does text search only, by design:** `q`, `relevance` and paging.
    - `container.ts` creates `new InMemorySearchEngine({ capabilities: textSearchOnly() })`.
    - With no options, the engine is also text-only, so nothing extra is enabled by default.
    - Capabilities are always explicit: `textSearchOnly()` or `allCapabilities()`.
  - **Additional, built and unit-tested, not enabled in the running app:**
    - the `category`, `minPrice`, `maxPrice` and `minRating` filters;
    - the `rating_desc`, `price_asc`, `price_desc` and `title_asc` sorts.
    - They are switched on by passing more capabilities (`allCapabilities()`) or by plugging in a real engine, with no route or contract change.
  - The full `GET /products` contract and its shape validation stay in place, and paging is always supported.
  - Index sync (resolved OQ-2): before each search, the route hands the cached catalogue to `engine.index()`, which is skipped when the catalogue hasn't changed.
  - On iOS, every `ProductQuery` field is optional and only non-nil fields are sent.
- **History:** This narrows the earlier choice that the in-memory engine "supports all filters and sorts" by default. After review, the running app was limited to what the acceptance criteria need (AC-3, text search), and capabilities were made explicit, so nothing is enabled by accident.
- **Why:**
  - A real engine plugs in without touching routes or the app.
  - Only enabling what AC-3 needs keeps the live surface small and honest. The extra logic is ready, but nobody depends on it yet.
  - Rejecting loudly means clients never get silently wrong results.
  - The warning shows when clients rely on something the current engine can't do.
- **Proof:**
  - The default engine returns 400 plus a warning for `category`, `minPrice`, `maxPrice`, `minRating` and every non-relevance sort.
  - A fake engine that supports everything receives the exact parsed query.
  - The same real engine created with `allCapabilities()` serves the extra filters and sorts.
- **Known limits:** see "Known limits" below.
- **Blueprint:** §5.4, §5.5, §5.7, §6.4, §7.5, §9.1

### D-009 — One error envelope, four codes
- **Decision:**
  - Envelope: `{ "error": { "code", "message" } }`.
  - Codes: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `UPSTREAM_ERROR` (502), `INTERNAL_ERROR` (500). That is the complete set.
  - An email send failure returns 502 `UPSTREAM_ERROR`.
  - Unknown routes and unknown products return 404 `NOT_FOUND`.
- **Why:**
  - A small, stable set keeps client handling simple.
  - Status and code map one-to-one, so a body over the size limit is also a 400.
- **Blueprint:** §5.9

### D-010 — Enquiry rules
- **Decision:**
  - `productId`, `name` and `email` are required. `message` is optional.
  - Length limits: name 1–100, email up to 254, message up to 2000.
  - CR/LF and control characters are rejected in `name` and `email`.
  - An unknown product returns 404.
  - The email is plain text, goes to `SALES_INBOX_EMAIL` from `MAIL_FROM`, and has `Reply-To` set to the customer.
  - Sending is synchronous. A failure returns 502, and the app shows an error with Retry. There is no queueing.
  - Sending is bounded by `SMTP_TIMEOUT_MS` (10 s), which sets the connection, greeting and socket timeouts. A hanging mail server therefore gives a 502 within seconds, not after nodemailer's multi-minute defaults.
- **Why:**
  - This prevents header injection and keeps behaviour predictable.
  - A queue (for example SQS) is the next step if delivery guarantees are needed.
- **Blueprint:** §5.8, §6.9

### D-011 — How the cache works: stale-while-revalidate, with back-off and a 24 h cap
- **Decision:** The catalogue (one snapshot) and each image are cached in memory, and every Fake Store call has a timeout (`PRODUCT_API_TIMEOUT_MS`, 5 s).
  - **Fresh** (younger than `PRODUCT_CACHE_TTL_SECONDS`, 5 min): served from memory.
  - **Expired:** the copy is still returned **immediately**, and one background refresh fetches a new copy for the next requests.
    - **Refresh succeeds:** the copy is replaced.
    - **Refresh fails:** one warning is logged and the old copy keeps being served. No new refresh starts for `CACHE_RETRY_BACKOFF_SECONDS` (30 s).
  - **Older than `PRODUCT_STALE_MAX_AGE_SECONDS` (24 h):** the request waits for a refresh and gets a 502 if it fails.
  - **No copy at all** (first load): the request waits for the fetch. A warm-up at startup normally does this before any user arrives.
- **What users see:**
  - Users never wait for Fake Store after the first load.
  - Data is at most one refresh behind: normally at most one TTL old, plus the time a refresh takes.
  - During an outage, the data can be up to 24 hours old, and a warning is logged every 30 seconds.
- **Why:**
  - The catalogue is small (about 20 items), so one snapshot serves every read endpoint.
  - With a plain TTL, one unlucky request every 5 minutes waits for Fake Store, up to the 5 s timeout when it's slow. Stale-while-revalidate takes Fake Store's speed off the request path.
  - The back-off stops a struggling upstream being retried on every request. The cap stops very old data (for example, old prices) being shown as current.
  - Fake Store is a free public API that does go down.
- **Trade-offs:**
  - The first request after the TTL gets data that is up to one refresh old. For a product catalogue that's fine; for stock levels or prices with legal weight it wouldn't be.
  - Recovery is noticed up to 30 seconds late.
  - Background refreshes run outside any request. Their errors are always caught and logged, so they never become unhandled rejections.
  - Each instance has its own cache. Redis or ElastiCache can replace it later behind the same adapter.
  - With no usable copy there's no back-off, so each request still tries upstream. Failures are never cached.
- **Tests (catalogue and images):**
  - An expired copy is returned without waiting for upstream.
  - Concurrent requests trigger exactly one background refresh.
  - A successful refresh replaces the copy.
  - A failed refresh keeps the old copy and logs once.
  - The back-off is respected.
  - Past the cap, the request waits and gets a 502.
  - A failed warm-up doesn't stop the server.
- **Blueprint:** §5.6, §9.1

### D-028 — One malformed upstream product rejects the whole catalogue
- **Decision:** The Fake Store response is validated as a whole. If any product fails the schema (a missing field, a wrong type, a rating out of range), the whole response is rejected as `UpstreamError`. The API then serves the stale copy (D-011) or returns 502.
- **Why:**
  - We never serve partly valid data.
  - Dropping only the bad items would quietly change featured selection, category top-3 and search results, and nobody would notice.
  - Rejecting the whole response is loud: a warning, or a 502 that shows up in logs.
- **Trade-off:** One bad record can take the catalogue down once the stale copy runs out. With a real database, per-record validation at import time is the better place for this.
- **Blueprint:** §5.6

### D-012 — Product detail fetches by id
- **Decision:** The detail screen calls `GET /products/{id}` instead of receiving the model.
- **Why:**
  - Every screen gets the four states.
  - It depends only on its `Route` (`.product(id:)`).
  - The data is always fresh.
- **Blueprint:** §6.5, §7.8

### D-019 — No image URL in the product payload
- **Decision:** Images are always at `GET /products/{id}/image`. The app builds that path from the id via `Endpoints`.
- **Why:** The app never follows URLs supplied by the server, and the upstream URL never leaks.
- **Trade-off:** A future CDN would need a new field or a redirect. That change would go through the blueprint.
- **Blueprint:** §6.1, §6.6

### D-020 — `currency` field, set by the adapter
- **Decision:** `Product` carries a `currency` field. The Fake Store adapter sets it to `"USD"`.
- **Why:**
  - Fake Store prices have no currency.
  - Stating it in the adapter keeps that assumption at the source boundary, so a future source supplies its own.
- **Blueprint:** §5.4, §6.1

### D-024 — Small API shape choices
- **Decision:**
  - No `/v1` prefix in the PoC. It can be added at the router mount point when the first breaking change comes.
  - `POST /enquiries` returns `200 { "status": "sent" }`. Sending is synchronous and no resource is created.
  - iOS search sends only `q` and asks for page 1 at the default size of 20. That covers the 20-product catalogue, so there is no pagination UI.
  - On product detail, a 404 shows as the empty state ("no longer available"), not as an error.
- **Blueprint:** §6, §7.8

### D-027 — Search returns ids; the store loads the products
- **Decision:** The engine returns ids, and the repository loads the products in one batched `getByIds`.
- **Why:** Prices and details always come from the source of truth, never from an index that may be out of date.
- **Trade-off:**
  - One extra lookup per search: microseconds in memory, a few ms against a database.
  - If latency ever matters, the index can store full products instead, and the API wouldn't change.
- **Blueprint:** §5.7

---

## Stack and architecture

### D-025 — Stack choice
- **iOS: SwiftUI.**
  - It is the developer's strongest platform.
  - That leaves the time for architecture instead of learning a stack.
- **Backend: Node.js + TypeScript + Express.**
  - **Node.js:** the backend mostly waits on other services (Fake Store, the image proxy, email), which Node's non-blocking I/O handles well.
  - **TypeScript:** strict mode catches contract mistakes at compile time.
  - **Express:** minimal and easy to read, with middleware for validation and a single error handler.
  - **Deployment:** a small container that runs on ECS, App Runner or Lambda.
- **Alternatives considered:**
  - NestJS felt too heavy for a PoC.
  - Laravel would add a PHP toolchain for the reviewer.
- **Blueprint:** §5.1, §7.1

### D-026 — MVVM-C with a single coordinator
- **Decision:**
  - One `AppCoordinator` owns all navigation and creates every screen and ViewModel.
  - No child coordinators.
- **Why:**
  - Child coordinators are overkill for 5 screens.
  - The coordinator can be split per flow later, for example a checkout flow.
- **Blueprint:** §7.3, §7.4

### D-021 — Single `NavigationStack`, no tab bar
- **Decision:** Home is the root. It shows featured products and categories and owns the search field.
- **Why:**
  - A tab bar needs one navigation path per tab.
  - That conflicts with a single coordinator owning one `path: [Route]` (D-026).
- **Blueprint:** §7.4, §7.8

### D-022 — Image loading goes through the ViewModel
- **Decision:**
  - A `ProductImageLoader`, owned by each ViewModel that shows tiles, calls `ImageService`.
  - Views forward a "tile appeared" intent.
- **Why:** `AsyncImage`, or a view calling a service directly, would break View → ViewModel → Service layering and bypass `NetworkClient`.
- **Blueprint:** §7.6

### D-023 — Theme injected through the SwiftUI environment
- **Decision:** `AppTheme` is a value set once at the root, not global static constants.
- **Why:** The look and feel will change, and this gives it one injection point.
- **Blueprint:** §7.9

### D-013 — iOS 18 minimum, local HTTP via xcconfig
- **Decision:**
  - The deployment target is iOS 18, which requires Xcode 16+.
  - `NSAllowsLocalNetworking` allows plain HTTP to `localhost` only.
  - `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS` come from xcconfig through `Info.plist`.
- **Why:**
  - iOS 18 removes availability checks for iOS 18 SwiftUI APIs.
  - The local networking exception is the narrowest ATS exception that lets the simulator reach the local backend.
- **Blueprint:** §7.1, §7.7, §8.1, §8.4

### D-014 — Previews use the real ViewModel with mock services
- **Decision:** There are no protocol-wrapped or mock ViewModels.
- **Why:**
  - Views hold a concrete `@Observable` ViewModel in `@State`, and a protocol in front of it adds boilerplate for no gain.
  - Mock services also exercise the real ViewModel logic in previews.
- **Blueprint:** §7.7

### D-017 — Backend dependencies: `express` v5, `zod`, `nodemailer`
- **Why:**
  - `express` v5 is the chosen framework (D-025) and handles async errors natively.
  - `zod` covers both strict request validation (rejecting unknown fields) and upstream response validation.
  - `nodemailer` works with Mailpit now and with SES over SMTP later.
- **Dev tools:** `typescript`, `tsx`, `vitest`, `supertest`.
- **Not used:** a logging library. A small JSON logger is injected instead.
- **Blueprint:** §5.1

### D-018 — Node.js 24 LTS
- **Why:**
  - Node 24 is the current LTS.
  - The Node 20 installed locally reached end of life in April 2026.
  - Docker pins the version, so the host version only matters for running tests outside Docker.
- **Blueprint:** §5.1, §8.1

---

## Process

### D-015 — CLAUDE.md holds rules only; the blueprint holds everything project-specific
- **Decision:**
  - `CLAUDE.md` holds stack-agnostic rules for how to work.
  - Architecture, names, paths, the API and the delivery flow live in `docs/BLUEPRINT.md`.
- **Why:**
  - The rules stay stable while the design changes.
  - The design has one source of truth, not two that drift apart.

### D-016 — Delivery flow
- **Decision:**
  - Blueprint and docs are committed straight to `feature/product-catalogue`.
  - The backend PR comes first, from `feature/product-catalogue-backend`, then the iOS PR from `feature/product-catalogue-ios`. Both merge into `feature/product-catalogue`.
  - The final PR into `main` stays open.
  - Nothing is pushed, opened or merged without the go-ahead.
- **Blueprint:** §10.1

---

## Dropped or simplified, and why

| Dropped / simplified | Why |
|---|---|
| Text search only in the running app; no sort/filter UI on iOS | The contract and the extra filter/sort logic are built and unit-tested (D-008). Enabling them is a capability switch on the backend plus app-only UI work. |
| No rate limiting or spam protection on enquiries | Out of scope for a PoC with no public deployment. Add it at the edge (API Gateway or WAF) or as middleware before going live. |
| No auth and no admin screen | Featured ids come from config (D-002), so nothing needs an admin UI yet. |
| No enquiry persistence | The email is the record for now. A table or queue comes when delivery guarantees or reporting are needed. |
| No infrastructure-as-code | The Docker image, `/health` and env-based config are the AWS-ready parts. CDK or Terraform come with the first real environment. |

## Known limits (search)

| Limit | What it means today | Where it gets fixed |
|---|---|---|
| Relevance isn't real relevance yet | `relevance` keeps the upstream order. A product that matches in the title ranks no higher than one that matches in the description. | A real engine ranks by match quality. |
| No typo tolerance or word splitting | Matching is one case-insensitive phrase, so "rng" or "ring gold" won't find "Gold Ring". | The job of the future engine (Typesense, OpenSearch, Postgres full-text). |
| Everything is in memory | Fine for 20 products, not for 20,000: each search scans the whole catalogue in the API process. | That's why search sits behind `ProductSearchEngine`: a real engine is one adapter. |
| Indexing is "keep the latest catalogue" | The route hands the engine the cached catalogue before each search. | A real engine is fed by a sync job when products change, not before each search. |

## How it grows (now → production)

| Now | Production | What changes in the code |
|---|---|---|
| Fake Store | Postgres or DynamoDB | A new `ProductRepository` adapter, wired in `container.ts` |
| In-memory search | **Postgres full-text** (no new infra if the store is Postgres), **OpenSearch** (AWS managed, scale and relevance tuning) or **Typesense** (simple, typo tolerant) | A new `ProductSearchEngine` adapter declaring its capabilities |
| Mailpit | Amazon SES | SMTP config only, using the same `SmtpEmailService`, with no code change:<br>• `SMTP_HOST=email-smtp.<region>.amazonaws.com` and SES SMTP credentials in `SMTP_USER` / `SMTP_PASS`;<br>• **port 587 with `SMTP_SECURE=false`**, where the connection is upgraded with STARTTLS (SES requires it);<br>• or **port 465 with `SMTP_SECURE=true`**, with TLS from the start. |
| Docker Compose | ECS Fargate or App Runner | Nothing: the same image and `/health` |
| `.env` | Secrets Manager or Parameter Store | Nothing: injected as env vars by the task definition |
| In-memory cache | Redis / ElastiCache | Behind the same repository adapter |
| Look and feel | New theme | `AppTheme` tokens for colors, typography, spacing, corner radius and elevation. Layout changes stay inside views. |

## What I'd do next with another day

- **Move the iOS project to Tuist.**
  - The project is generated from a Swift manifest, so there are no `.xcodeproj` merge conflicts.
  - It splits into modules: `Core`, `Networking`, `DesignSystem`, `Features`.
- **Switch search to cursor-based paging.**
  - Today paging is offset-based (`page`, `pageSize`).
  - If the catalogue refreshes mid-browse, items can shift between pages, so a user may see one twice or miss one.
  - A cursor (for example, the last item's sort key and id) keeps pages stable.
- **Set up environments: Dev, Staging and Prod.**
  - Each gets its own xcconfig (base URL, app name, bundle id).
  - Each gets its own scheme.
