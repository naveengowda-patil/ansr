# Decisions

Assumptions and trade-offs that fill gaps in the acceptance criteria. The blueprint ([`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)) states *what* is built. This file records *why*.

**Status:** D-001 to D-016 are **Agreed**, meaning confirmed by the product owner on 2026-11-22 and 2026-11-25. D-017 to D-024 are **Proposed**: I introduced them while writing the blueprint, and they are waiting for blueprint review. When one is accepted, move it up and mark it Agreed.
---

## Agreed

### D-001 — The app reaches product data only through our backend, images included
- **Decision:** The iOS app never calls `fakestoreapi.com`. The backend proxies images at `GET /products/{id}/image`, and the app loads them through `NetworkClient`.
- **Why:** The data source will change, so the client must not depend on it. The proxy takes a product **id**, not a URL. The backend looks up the upstream URL itself and only fetches from the configured origin, which avoids an open proxy and SSRF.
- **Trade-off:** The backend does extra work and holds a cache for image bytes.
- **Blueprint:** §5.6, §6.6, §7.6

### D-002 — Home "top rated" is a configured, ordered list
- **Decision:** `FEATURED_PRODUCT_IDS` is ordered. Missing ids are skipped. If fewer than 5 remain, the list fills up with the highest-rated products. Exactly 5 is a fixed constant. If the list has more than 5 ids, the first 5 that exist are used.
- **Why:** "Picked by the business" means business-curated, not computed. The fill keeps the home screen full when picked products disappear upstream.
- **Blueprint:** §2 AC-1, §5.5

### D-003 — Ranking tie-break
- **Decision:** Sort by `rating.rate` descending, then `rating.count` descending, then `id` ascending.
- **Why:** The result is deterministic, so tests are stable. More reviews is a sensible secondary signal.
- **Blueprint:** §5.5

### D-004 — Category view = 3 top rated, then the rest
- **Decision:** `topRated` holds the 3 highest-rated products. `rest` holds the remaining products in upstream order, with no duplicates. The response is `{ category, topRated, rest }`. When a category has 3 or fewer products, `rest` is empty. An unknown category returns 404.
- **Why:** Two explicit lists let the app render two sections without re-deriving the rule client-side. This is a domain function, not search-engine sorting.
- **Blueprint:** §2 AC-2, §5.5, §6.8

### D-005 — Add `GET /categories`
- **Decision:** A new endpoint returns the category names.
- **Why:** The app needs the list to let a user "open a category". It wasn't in the acceptance criteria, but it is implied by them.
- **Blueprint:** §6.7

### D-006 — Add `GET /health` (liveness only)
- **Decision:** Returns `{ "status": "ok" }` and doesn't check upstream services.
- **Why:** AWS target groups and App Runner need a health check. Checking Fake Store there would get healthy instances replaced during an upstream outage.
- **Blueprint:** §6.2, §8.3

### D-007 — Search matching
- **Decision:** The term is trimmed and matched as a case-insensitive substring of the whole phrase in the title or description. Category text doesn't count. A present-but-blank `q` returns 400. Filtering happens in the backend. The search runs only when the user submits it.
- **Why:** This is the simplest rule that matches the acceptance criteria. Tokenised or fuzzy matching is the job of a future search engine (see D-008).
- **Blueprint:** §2 AC-3, §5.5, §6.4

### D-008 — Search is a swappable engine behind a capability contract
- **Decision:** `ProductRepository` is the source of truth. `ProductSearchEngine` only returns `{ ids, total }`. `GET /products` accepts the full query (`q`, `category`, price and rating filters, `sort`, paging). The engine declares which filters and sorts it supports, and anything it doesn't support returns 400 "not supported yet". `InMemorySearchEngine` supports `q`, `category` and paging, with relevance as upstream order. On iOS, `ProductQuery` carries every field, but only the non-nil ones are sent.
- **Why:** A real search engine can be plugged in later without changing routes or the iOS app. Rejecting unsupported filters loudly means a client never gets silently wrong results.
- **Trade-off:** The API surface is bigger than today's UI uses. A test with a fake engine that supports everything proves the path works end to end.
- **Blueprint:** §5.4, §5.7, §6.4, §7.5

### D-009 — One error envelope, four codes
- **Decision:** Errors use `{ "error": { "code", "message" } }`. The codes are `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `UPSTREAM_ERROR` (502) and `INTERNAL_ERROR` (500), and that is the complete set. Email send failure returns 502 `UPSTREAM_ERROR`. Unknown routes and unknown products return 404 `NOT_FOUND`.
- **Why:** A small, stable set keeps client error handling simple. HTTP status and code map one-to-one, so a body over the size limit is also returned as 400.
- **Blueprint:** §5.9

### D-010 — Enquiry rules
- **Decision:**
  - `productId`, `name` and `email` are required. `message` is optional.
  - Limits: name 1–100 characters, email up to 254, message up to 2000.
  - CR/LF and other control characters are rejected in `name` and `email`.
  - An unknown product returns 404.
  - The email is plain text, sent to `SALES_INBOX_EMAIL` from `MAIL_FROM` with `Reply-To` set to the customer.
  - Sending is synchronous: if it fails, the API returns 502 and the app shows an error with Retry. There is no queueing.
- **Why:** These rules prevent header injection and keep the behaviour predictable. A queue (for example SQS) is the next step if delivery guarantees are needed.
- **Blueprint:** §5.8, §6.9

### D-011 — Upstream timeout and cache
- **Decision:**
  - Every Fake Store call has a timeout (`PRODUCT_API_TIMEOUT_MS`).
  - The whole catalogue is fetched once and cached in memory for `PRODUCT_CACHE_TTL_SECONDS`, default 300.
  - Concurrent cache misses share one request.
  - Stale data is not served when the upstream fails.
- **Why:** The catalogue is small (about 20 items), so one cached snapshot serves every read endpoint. Serving stale data adds complexity the PoC doesn't need.
- **Trade-off:** Each instance has its own cache. That is fine for this stage; with many instances, a shared cache such as ElastiCache could replace it behind the same adapter.
- **Blueprint:** §5.6

### D-012 — Product detail fetches by id
- **Decision:** The detail screen calls `GET /products/{id}` rather than receiving the model from the previous screen.
- **Why:** Each screen gets the full set of four states and depends only on its `Route` (`.product(id:)`), and the data is always fresh.
- **Blueprint:** §6.5, §7.8

### D-013 — iOS 17, local HTTP and xcconfig
- **Status:** Agreed
- **Decision:**
  - The deployment target is iOS 17, needed for `@Observable`.
  - `NSAllowsLocalNetworking` allows plain HTTP to `localhost` only.
  - `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS` come from xcconfig through `Info.plist`.
- **Blueprint:** §7.1, §7.7

### D-014 — Previews use the real ViewModel with mock services
- **Status:** Agreed
- **Decision:** There are no protocol-wrapped or mock ViewModels.
- **Why:** Views hold a concrete `@Observable` ViewModel in `@State`. Putting a protocol in front of it adds boilerplate with no benefit. Mock services exercise the real ViewModel logic in previews too.
- **Blueprint:** §7.7

### D-015 — CLAUDE.md holds rules only; the blueprint holds everything project-specific
- **Status:** Agreed
- **Decision:** `CLAUDE.md` holds stack-agnostic rules for how to work. Architecture, names, paths, the API and the delivery flow live in `docs/BLUEPRINT.md`.
- **Why:** The rules stay stable while the design changes, and the design has one source of truth instead of two that drift.

### D-016 — Delivery flow
- **Status:** Agreed
- **Decision:**
  - Blueprint and docs are committed straight to `feature/product-catalogue`.
  - The backend PR comes first, from `feature/product-catalogue-backend`.
  - The iOS PR follows, from `feature/product-catalogue-ios`.
  - Both merge into `feature/product-catalogue`.
  - The final PR into `main` stays open.
  - Nothing is pushed, opened or merged without the go-ahead.
- **Blueprint:** §10.1

---

## Proposed (pending blueprint review)

### D-017 — Backend dependencies: `express` v5, `zod`, `nodemailer`
- **Why:**
  - Express is the required stack, and v5 handles async errors natively.
  - zod covers strict request validation (rejecting unknown fields) and upstream response validation with one tool.
  - nodemailer works with Mailpit now and with SES over SMTP later.
- **Dev tools:** `typescript`, `tsx`, `vitest`, `supertest`.
- **Not used:** a logging library, replaced by a small injected JSON logger.
- **Blueprint:** §5.1

### D-018 — Node.js 24 LTS
- **Why:** Node 24 is the current LTS. The Node 20 installed locally reached end of life in April 2026. Docker pins the version, so the host Node version only matters for running tests outside Docker.
- **Blueprint:** §5.1, §8.1

### D-019 — No image URL in the product payload
- **Decision:** Images are always at `GET /products/{id}/image`, and the app builds that path from the id with `Endpoints`.
- **Why:** The app never follows URLs supplied by the server, and the upstream URL never leaks.
- **Trade-off:** A future CDN would need either a new field or a redirect. That change would go through the blueprint.
- **Blueprint:** §6.1, §6.6

### D-020 — `currency` field, set by the adapter
- **Decision:** `Product` carries `currency`. The Fake Store adapter sets it to `"USD"`.
- **Why:** Fake Store prices have no currency. Making the adapter state it keeps that assumption at the source boundary, so a future source supplies its own.
- **Blueprint:** §5.4, §6.1

### D-021 — Single `NavigationStack`, no tab bar
- **Decision:** Home is the root. It shows featured products and categories and owns the search field.
- **Why:** A tab bar needs one navigation path per tab, which conflicts with a single coordinator owning one `path: [Route]`. One stack keeps navigation in one place.
- **Blueprint:** §7.4, §7.8

### D-022 — Image loading goes through the ViewModel
- **Decision:** A `ProductImageLoader`, owned by each ViewModel that shows tiles, calls `ImageService`. Views forward a "tile appeared" intent.
- **Why:** Using `AsyncImage` or letting a view call a service would break the View → ViewModel → Service layering and bypass `NetworkClient`.
- **Blueprint:** §7.6

### D-023 — Theme injected through the SwiftUI environment
- **Decision:** `AppTheme` is a value set once at the root, rather than global static constants.
- **Why:** The look and feel is expected to change, so swapping the theme should be a single injection point.
- **Blueprint:** §7.9

### D-024 — Small API shape choices
- **Decisions:**
  - There is no `/v1` prefix in the PoC. It can be added at the router mount point when the first breaking change comes.
  - `POST /enquiries` returns `200 { "status": "sent" }`, because sending is synchronous and no resource is created.
  - Search on iOS sends only `q` and requests page 1 at the default page size of 20. That covers today's 20-product catalogue, so there is no pagination UI.
  - On product detail, a 404 is shown as the empty state ("no longer available") rather than as an error.
- **Blueprint:** §6, §7.8
