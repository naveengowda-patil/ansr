# Backend architecture

A reader's guide to the backend: what each part does, where it lives, and how the parts fit together.

> **The exact rules live in [`BLUEPRINT.md`](BLUEPRINT.md), the single source of truth.** This guide explains and links to it. It doesn't define rules of its own. If the two ever disagree, the blueprint wins, and the mismatch should be raised.

The backend is a small Node.js + TypeScript (Express) API. The iOS app talks only to it. It reads products from Fake Store (images included), keeps them in memory, answers search, and sends enquiry emails, which Mailpit catches locally.

```
 iOS app ──HTTP/JSON──▶ 1. API (Express app: routes, validation, error middleware)
                           │        │            │             │
                           ▼        ▼            ▼             ▼
                   6. Domain    2. Product    3. Search     4. Email ──▶ SMTP (Mailpit / SES)
                      rules     Repository     Engine        Service
                   (pure)          │  ▲ cache
                                   ▼
                              fakestoreapi.com

 5. Logger: used by all of the above, one JSON line per event → stdout
 7. Config + Container: read settings once, build and wire 2–5, start the server
 8. Running and deployment: Docker Compose locally, the same image on AWS
```

Sections 2–5 sit behind interfaces (ports) in `backend/src/ports/`. The routes in section 1 depend only on those interfaces, and only the container (section 7) knows the concrete classes. Rules: [BLUEPRINT.md §4](BLUEPRINT.md#4-architecture-overview), [§5.3](BLUEPRINT.md#53-boundary-rules).

---

## 1. API (Express app)

**The front door. It receives every request from the iOS app, checks the input is valid, asks the other services for what it needs, and sends back the answer.**

- **Files:**
  - `backend/src/app.ts`
  - `backend/src/routes/` (`health.ts`, `products.ts`, `categories.ts`, `enquiries.ts`)
  - `backend/src/http/` (`errorHandler.ts`, `validate.ts`, `params.ts`)
  - `backend/src/errors.ts`
- **Public functions:**
  - `createApp(deps: AppDeps)` builds the app without opening a port.
  - `healthRouter()`, `productsRouter(deps)`, `categoriesRouter(deps)` and `enquiriesRouter(deps)`.
  - `errorHandler(logger)` and `notFoundHandler`.
  - `parseQuery`, `parseBody` and `parseWith` turn zod schemas into a `ValidationError`.
  - The error classes `ValidationError`, `NotFoundError` and `UpstreamError`.
- **How it works:**
  - **Request handling:**
    - JSON bodies are parsed with a size limit.
    - Each route validates its input with a strict zod schema, then calls the interfaces (sections 2–4) and the pure rules (section 6).
    - It returns JSON. The only exception is the image route, which returns bytes.
  - **Errors:** every error, thrown or rejected, ends in one error middleware. It maps it to the single envelope and one of four codes. Upstream and unexpected failures get a fixed, safe message, and the details only go to the log.
  - **Search** (`GET /products`):
    1. validate the shape;
    2. check the engine's capabilities;
    3. sync the index;
    4. search for ids;
    5. load the products from the repository.
- **Config used** (via `AppDeps.settings`, never read from the environment here): `JSON_BODY_LIMIT`, `FEATURED_PRODUCT_IDS`, `IMAGE_CLIENT_MAX_AGE_SECONDS`, `SALES_INBOX_EMAIL`, `MAIL_FROM`.
- **Log events:**
  - `request.rejected` (info, 4xx)
  - `request.failed` (error, 5xx)
  - `search.unsupported` (warn)
  - `search.executed` (debug)
  - `enquiry.sent` (info)
- **Tests:**
  - `backend/test/routes/` (`health`, `products`, `categories`, `enquiries`, `errors`, `searchPlugAndPlay`), using Supertest against `createApp`.
  - The fakes are in `test/support/testApp.ts` and `fakes.ts`.
- **Rules:**
  - [BLUEPRINT.md §5.3](BLUEPRINT.md#53-boundary-rules) (boundaries, `AppDeps`)
  - [§5.9](BLUEPRINT.md#59-errors) (errors)
  - [§5.7](BLUEPRINT.md#57-search-design) (search flow)
  - [§6](BLUEPRINT.md#6-api-contract) (every endpoint; quick reference in [`API_CONTRACT.md`](API_CONTRACT.md))

## 2. Product Repository

**The product warehouse. It's the only service that knows where products come from (Fake Store today). It fetches them, keeps a copy in memory for a while, and hands out products, categories and images.**

- **Files:**
  - `backend/src/ports/ProductRepository.ts` (the interface)
  - `backend/src/adapters/fakestore/FakeStoreProductRepository.ts` and `schema.ts`
  - `backend/src/lib/TtlCache.ts`
- **Public functions:**
  - `ProductRepository`: `getAll()`, `getById(id)`, `getByIds(ids)`, `listCategories()` and `getImage(id)`.
  - `TtlCache`: `get(key, load, onBackgroundError?)` and `whenIdle()`.
- **How it works:**
  - **Loading:** one request to Fake Store `/products` loads the whole catalogue.
    - It's validated as a whole, so one bad product rejects the response.
    - It's mapped to the API's `Product` shape with a currency, and the upstream image URLs stay internal.
  - **Caching:** the catalogue and each image are cached with stale-while-revalidate. Once there is a copy, requests never wait for Fake Store.
    - An expired copy is served while one background refresh runs.
    - Failed refreshes back off.
    - A copy is never older than the 24 h cap.
  - **Images** are only fetched through the guards: host allowlist, no redirects, timeout, raster types only, and a size cap.
  - **Warm-up:** the catalogue is loaded once at startup (section 7).
- **Config used:**
  - `PRODUCT_API_BASE_URL`, `PRODUCT_API_TIMEOUT_MS`
  - `PRODUCT_CACHE_TTL_SECONDS`, `PRODUCT_STALE_MAX_AGE_SECONDS`, `CACHE_RETRY_BACKOFF_SECONDS`
  - `IMAGE_HOST_ALLOWLIST`, `IMAGE_TIMEOUT_MS`, `IMAGE_MAX_BYTES`, `IMAGE_CACHE_MAX_ENTRIES`
- **Log events:**
  - `cache.hit`, `cache.miss` and `cache.stale` (debug, from `TtlCache`)
  - `upstream.request` and `image.fetched` (debug)
  - `catalogue.refresh_failed` and `image.refresh_failed` (warn)
- **Tests:**
  - `backend/test/adapters/fakeStoreProductRepository.test.ts` and `backend/test/lib/TtlCache.test.ts`.
  - They use the recorded `test/fixtures/fakestore/products.json`, with a fake fetch and a fake clock from `test/support/fakeStore.ts`.
- **Rules:**
  - [BLUEPRINT.md §5.4](BLUEPRINT.md#54-ports-interfaces) (interface)
  - [§5.6](BLUEPRINT.md#56-fake-store-adapter-fakestoreproductrepository) (adapter, cache, image guards, warm-up)
  - [D-011](../DECISIONS.md) (how the cache works)

## 3. Search Engine

**The librarian. Given a search ("backpack, under $100, cheapest first"), it says which product IDs match and in what order. It doesn't hold the real product details.**

- **Files:**
  - `backend/src/ports/ProductSearchEngine.ts`
  - `backend/src/adapters/search/InMemorySearchEngine.ts`
  - `backend/src/domain/search.ts` (the matching, filter and sort rules, and the capability sets)
- **Public functions:**
  - `ProductSearchEngine`: `name`, `capabilities`, `index(products)`, and `search(query)` returning `{ ids, total }`.
  - `textSearchOnly()`, `allCapabilities()` and `findUnsupported(query, capabilities)`.
- **How it works:**
  - **Capabilities:** each engine declares the filters and sorts it supports.
    - The API rejects anything else before the engine sees the query.
    - The running app's engine does **text search only**: `q`, relevance order and paging.
    - The other filters and sorts in the example above are *additional: built and unit-tested, not enabled in the running app*. They're switched on by passing more capabilities, or by plugging in a real engine.
  - **Ids first:** the engine returns ids only. The API then loads the real products from the repository, so prices and details always come from the source of truth.
- **Config used:** none. The capabilities are chosen explicitly in `container.ts` (section 7).
- **Log events:** `search.unsupported` (warn) and `search.executed` (debug), both written by the products route.
- **Tests:** `backend/test/adapters/inMemorySearchEngine.test.ts`, `backend/test/routes/searchPlugAndPlay.test.ts` and `backend/test/domain/search.test.ts`.
- **Rules:**
  - [BLUEPRINT.md §5.4](BLUEPRINT.md#54-ports-interfaces) (interface)
  - [§5.5](BLUEPRINT.md#55-domain-rules-pure-functions) (matching, filters, sorts, capabilities)
  - [§5.7](BLUEPRINT.md#57-search-design) (design and flow)
  - [D-008](../DECISIONS.md) and the known search limits in `DECISIONS.md`

## 4. Email Service

**The post office. It takes a finished email and sends it (to Mailpit today, Amazon SES later).**

- **Files:**
  - `backend/src/ports/EmailService.ts`
  - `backend/src/adapters/email/SmtpEmailService.ts`
  - `backend/src/domain/email.ts` (the `EmailMessage` type)
  - `smtpTransportOptions` in `backend/src/container.ts`
- **Public functions:**
  - `EmailService`: `send(message)`.
  - `MailTransport`, the narrow `sendMail`-only interface the adapter depends on.
  - `smtpTransportOptions(smtp)`.
- **How it works:**
  - **Sending:** it sends one plain-text email over SMTP, with the customer as an encoded Reply-To. The email itself is built by section 6.
  - **Timeouts:** connection, greeting and socket are all bounded by one SMTP timeout.
  - **Failures:** any failure, including a timeout, becomes `UpstreamError`, so the API returns 502. Sending is synchronous, with no queue or retries.
  - **Amazon SES** is a configuration change only.
- **Config used:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_TIMEOUT_MS`, `MAIL_FROM` and `SALES_INBOX_EMAIL`.
- **Log events:**
  - `email.sending` and `email.sent` (debug, duration only, never addresses or content)
  - `enquiry.sent` (info, product id only, written by the route)
- **Tests:**
  - `backend/test/adapters/smtpEmailService.test.ts`: the rendered email, timeout mapping, and a real transport against a silent local server.
  - `backend/test/routes/enquiries.test.ts`.
  - `backend/test/container.test.ts`: the transport timeouts.
- **Rules:**
  - [BLUEPRINT.md §5.4](BLUEPRINT.md#54-ports-interfaces) (interface)
  - [§5.8](BLUEPRINT.md#58-enquiry-email) (email content, timeouts, SES settings)
  - [D-010](../DECISIONS.md)

## 5. Logger

**The diary. It writes down what happened (warnings, errors, enquiries sent) as one line per event, so problems can be investigated.**

- **Files:**
  - `backend/src/ports/Logger.ts`
  - `backend/src/adapters/logging/JsonLogger.ts`
  - `backend/src/ports/Clock.ts` (the injected clock used for durations)
- **Public functions:** `Logger`: `debug`, `info`, `warn` and `error`, each taking `(message, context?)`.
- **How it works:**
  - **Output:** each event is one JSON line on stdout, with a stable event name and its context. Lines below `LOG_LEVEL` are dropped, and errors are serialised with their cause.
  - **Injection:** the logger is injected into every part that logs, and only the container creates the concrete one.
  - **Debug events** exist for troubleshooting and are silent at the default `info` level.
  - **Never logged:** customer data and secrets, at any level.
  - **Durations** come from the injected clock.
- **Config used:** `LOG_LEVEL`.
- **Log events:** all of them. The full table, with levels and context, is in the blueprint.
- **Tests:**
  - `backend/test/adapters/jsonLogger.test.ts`.
  - `backend/test/logging.test.ts`: end to end, every debug event at `debug`, none at `info`, and no secrets or customer data.
  - The recording logger is in `test/support/fakes.ts`.
- **Rules:**
  - [BLUEPRINT.md §5.4](BLUEPRINT.md#54-ports-interfaces) (interface)
  - [§5.11](BLUEPRINT.md#511-log-events) (every event, its level and context, and the logging rules)

## 6. Domain rules

**The rulebook. These are pure calculations with no outside contact: which 5 products are featured, which 3 are top in a category, whether a search uses an unsupported filter, and what the enquiry email says.**

- **Files:** `backend/src/domain/`
  - `product.ts` and `email.ts` (types)
  - `ranking.ts`, `featured.ts`, `categoryRanking.ts`, `search.ts` and `enquiry.ts`
- **Public functions:**
  - `compareByRating`, `selectFeatured` and `splitTopRated`
  - `matchesText`, `matchesFilters`, `compareForSort` and `sameCategory`
  - `textSearchOnly`, `allCapabilities`, `findUnsupported`, `describeUnsupported` and `paginate`
  - `buildEnquiryEmail` and `stripLineBreaks`
- **How it works:**
  - **No I/O:** no network, no clock, no config reading. Everything comes in as arguments. For example, the route passes the featured ids and the time an enquiry was received.
  - **Easy to test and change:** that makes every rule trivially testable and easy to change in one place.
  - **Shared tie-break:** one ranking tie-break is used by every "highest rated" choice.
- **Config used:** none directly. `FEATURED_PRODUCT_IDS` reaches `selectFeatured` through the route.
- **Log events:** none. Pure functions don't log.
- **Tests:** `backend/test/domain/`: `ranking`, `featured`, `categoryRanking`, `search` and `enquiry`.
- **Rules:**
  - [BLUEPRINT.md §5.5](BLUEPRINT.md#55-domain-rules-pure-functions) (every rule)
  - [§5.8](BLUEPRINT.md#58-enquiry-email) (what the enquiry email contains)

## 7. Config + Container

**The setup crew. Config reads the settings once at startup (URLs, timeouts, email addresses). The container then builds each service above and connects them.**

- **Files:**
  - `backend/src/config.ts`
  - `backend/src/container.ts`
  - `backend/src/startup.ts`
  - `backend/src/server.ts` (the entry point)
- **Public functions:**
  - `loadConfig(env)`, `safeConfigSummary(config)` and `ConfigError`.
  - `createContainer(config, overrides?)`, returning `{ deps, close(), whenIdle() }`.
  - `smtpTransportOptions(smtp)`.
  - `startServer(options)` and `warmCatalogue(repository, logger)`.
- **How it works:**
  - **Config:** `config.ts` is the only place that reads environment variables. It validates all of them at once and fails at startup with one error listing every problem.
  - **Container:** `container.ts` is the only place that creates concrete classes. It builds the logger, the clock, both caches, the repository, the search engine (text search only, passed explicitly), and the SMTP transport and email service. It then hands them to the app as `AppDeps`.
    - **Test seams:** the mail transport factory, `fetch`, the log writer and the clock. Production uses the defaults.
  - **Startup** (`server.ts`):
    1. load config;
    2. build the container;
    3. `startServer` listens, then warms the catalogue without blocking (a failed warm-up only logs);
    4. on `SIGTERM` or `SIGINT`, shut down gracefully.
- **Config used:** all of it.
- **Log events:**
  - `config.loaded` (debug, safe allowlisted values only)
  - `server.started`, `catalogue.warmed` and `server.stopping` (info)
  - `catalogue.warmup_failed` (warn)
  - `server.close_failed` and `server.shutdown_timeout` (error)
  - `server.start_failed` (stderr, before a logger exists)
- **Tests:** `backend/test/config.test.ts`, `backend/test/container.test.ts` and `backend/test/startup.test.ts`.
- **Rules:**
  - [BLUEPRINT.md §5.3](BLUEPRINT.md#53-boundary-rules) (composition root, test seams)
  - [§5.10](BLUEPRINT.md#510-configuration) (every variable)
  - [§5.6](BLUEPRINT.md#56-fake-store-adapter-fakestoreproductrepository) (startup warm-up)

## 8. Running and deployment

**How the backend runs, locally and on AWS.**

- **Files:**
  - `backend/Dockerfile`
  - `docker-compose.yml`
  - `.env.example`
  - `.env` (optional, git-ignored)
  - `backend/package.json` (scripts) and `backend/.nvmrc`
- **How it works:**
  - **Locally:** one command from a fresh clone, `docker compose up --build` (Compose 2.24+).
    - It starts the API and Mailpit.
    - `.env.example` provides the defaults, and an optional `.env` overrides them.
  - **Without Docker:** `cd backend && npm run dev`. It reads the same two files, and you set `SMTP_HOST=localhost`.
  - **Tests:**
    - `cd backend && npm test` (Node 24);
    - or `docker build --target test backend` with no local Node.
  - **AWS:**
    - The same multi-stage, non-root image runs on ECS Fargate or App Runner.
    - It's stateless apart from a per-instance cache.
    - It has `/health` for health checks, config from the environment, and JSON logs to stdout for CloudWatch.
    - It shuts down gracefully on `SIGTERM` and warms the catalogue after a deploy.
- **Config used:** any variable can be overridden. `PORT` and `LOG_LEVEL` are the usual local ones.
- **Log events:** the `server.*` and `catalogue.warm*` events from section 7.
- **Tests:** `docker build --target test backend` runs the typecheck and the full suite on Node 24. `backend/test/startup.test.ts` covers startup.
- **Rules:**
  - [BLUEPRINT.md §8](BLUEPRINT.md#8-local-development-and-infrastructure), in particular [§8.2](BLUEPRINT.md#82-run-target-under-10-minutes) (run) and [§8.3](BLUEPRINT.md#83-aws-readiness) (AWS readiness)
  - [D-029](../DECISIONS.md) (one-command start)

---

## Request flows

Which sections each endpoint goes through. Section 5 (Logger) is involved in every flow. "Fake Store" is only called when the cache has no usable copy, or for a background refresh.

| Endpoint | Flow |
|---|---|
| `GET /health` | 1 → response (no upstream calls) |
| `GET /products/featured` | 1 → 2 (catalogue) → 6 (`selectFeatured`) → response |
| `GET /products?q=…` | 1 → 6 (`findUnsupported`) → 2 (catalogue) → 3 (`index`, `search`) → 2 (`getByIds`) → response |
| `GET /products/{id}` | 1 → 2 (`getById`) → response |
| `GET /products/{id}/image` | 1 → 2 (`getImage`: image guards, image cache) → bytes with cache and `nosniff` headers |
| `GET /categories` | 1 → 2 (`listCategories`) → response |
| `GET /categories/{category}` | 1 → 2 (catalogue) → 6 (`sameCategory`, `splitTopRated`) → response |
| `POST /enquiries` | 1 → 2 (`getById`) → 6 (`buildEnquiryEmail`) → 4 → Mailpit (SES later) |

## Security summary

| Safeguard | Where | Rules |
|---|---|---|
| Input validation: strict schemas, unknown and repeated params rejected, empty params rejected, body size limit | 1. API | [§6.4](BLUEPRINT.md#64-get-products-ac-3-search-and-listing), [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5), [§5.9](BLUEPRINT.md#59-errors) |
| CR/LF and control characters rejected in name and email; CR/LF stripped from the email subject | 1. API (validation), 6. Domain rules (subject) | [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5), [§5.8](BLUEPRINT.md#58-enquiry-email) |
| Image SSRF guards: product id only (never a URL), host allowlist, no redirects, timeout, size cap | 2. Product Repository | [§5.6](BLUEPRINT.md#56-fake-store-adapter-fakestoreproductrepository) |
| SVG blocked: only JPEG, PNG, WebP and GIF pass through | 2. Product Repository | [§5.6](BLUEPRINT.md#56-fake-store-adapter-fakestoreproductrepository), [§6.6](BLUEPRINT.md#66-get-productsidimage) |
| `X-Content-Type-Options: nosniff` on images | 1. API (image route) | [§6.6](BLUEPRINT.md#66-get-productsidimage) |
| Plain-text email only, never HTML | 4. Email Service, 6. Domain rules | [§5.8](BLUEPRINT.md#58-enquiry-email) |
| No customer data in logs, at any level | 5. Logger, 4. Email Service, 1. API | [§5.11](BLUEPRINT.md#511-log-events), [§5.8](BLUEPRINT.md#58-enquiry-email) |
| No secrets: `.env.example` secret-free, `.env` git-ignored, `config.loaded` allowlisted | 7. Config + Container, 8. Running | [§5.10](BLUEPRINT.md#510-configuration), [§5.11](BLUEPRINT.md#511-log-events), [§3](BLUEPRINT.md#3-constraints) |
| Error details hidden: one envelope, fixed messages for 502 and 500, details only in logs | 1. API (error middleware) | [§5.9](BLUEPRINT.md#59-errors) |

## Testing

The full matrix is in [BLUEPRINT.md §9.1](BLUEPRINT.md#91-backend-vitest), and the approach in [§9](BLUEPRINT.md#9-testing).

- **No network:**
  - Fake Store is replaced by a recorded fixture and a fake `fetch`.
  - SMTP is replaced by nodemailer's stream transport, a stub, or a silent local socket.
  - Routes are driven through Supertest without a port.
- **No sleeps:**
  - Time moves through an injected fake clock.
  - Background refreshes are awaited with `whenIdle()`.
- **Behaviour through public interfaces:** HTTP for routes, the interfaces for adapters, function results for domain rules.
- **Mutation checks:** after each change, the behaviour is deliberately broken in a scratch copy to confirm a test fails. A test that can't fail doesn't count.
- **Two places use the real `createContainer`:** the end-to-end logging test and the container tests, so the wiring itself is covered.
