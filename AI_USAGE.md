# AI Usage

This file covers how AI was used to build this project, which prompts shaped it, and where the AI got things wrong.

## Tools and models used

| Tool | Model | Used for |
|---|---|---|
| Claude Code (Claude desktop app, Code tab) | Claude Opus 5.5 (`claude-opus-5-5`) | Requirement clarification, blueprint and decision log drafting, implementation, tests, commits |

All AI output is reviewed by the developer before it is merged. Pushing, opening PRs and merging happen only on the developer's explicit go-ahead.

## Agent instruction files

- **[`CLAUDE.md`](CLAUDE.md)** — rules for *how* to work: source-of-truth process, design principles, code quality, security, UI, testing, git.
  - **Why rules only:** an earlier version mixed rules with architecture (file paths, interface names, screen details). Every design change would have meant editing the agent's instructions, and the two documents would drift apart. Keeping `CLAUDE.md` stack-agnostic means it stays stable, and the design lives in one place.

## Plan / spec

- **[`docs/BLUEPRINT.md`](docs/BLUEPRINT.md)** is the plan and spec, and the single source of truth. It holds requirements, architecture, the API contract, iOS design, config, test coverage and the delivery flow.
  - Every change starts as a blueprint edit, and code follows.
  - Its open questions and changelog show how the design evolved.
- **[`DECISIONS.md`](DECISIONS.md)** records why: assumptions and trade-offs, each linked to the blueprint section it shapes.

## Key prompts

These are the developer's prompts that significantly shaped development or led to a major decision. Each is summarised, followed by the decision it led to.

| # | Date | Prompt (summarised) | Decision / outcome |
|---|---|---|---|
| P-1 | 2026-11-22 | Project context: a PoC that becomes the real product's base. Data source, look and feel and email provider will change, so each sits behind a boundary. The app never talks to `fakestoreapi.com`, **not even for images**; the backend proxies them and the app loads them through `NetworkClient`. Asked the AI to confirm understanding and list gaps before building anything. | Backend-only data access, including an image proxy addressed by product id (D-001). The AI listed 11 gaps (image proxy design, tie-breaks, category shape, search edge cases, enquiry limits, cache/timeout, previews, detail fetch, iOS version and ATS, AWS health check, missing docs). |
| P-2 | 2026-11-22 | Same prompt: iOS is **MVVM-C with DI**: `AppConfiguration → AppDependencies → one AppCoordinator`, a central `NetworkClient`, services behind protocols, ViewModels with loading/loaded/empty/error states. | A single coordinator owns all navigation. Screens and ViewModels are created only there, with strict View → ViewModel → Service → NetworkClient layering (blueprint §7.3–7.4, D-021, D-026). |
| P-3 | 2026-11-22 | Same prompt: home "top rated" = **a configurable ordered list of product ids**. Missing ids are skipped, and the list fills up to 5 with the highest rated. Category "top rated" = the 3 highest rated, then the rest. | Business-curated featured list in config, ranking as pure domain functions (D-002, D-003, D-004). |
| P-4 | 2026-11-25 | Accepted the AI's defaults with tweaks: keep 4 error codes (`UPSTREAM_ERROR`, not a new `UPSTREAM_UNAVAILABLE`), previews use the real ViewModel, add `/categories` and `/health`. Set the process: blueprint first, backend PR then iOS PR into the feature branch, final PR to `main` kept open. | Fixed error-code set (D-009), D-005, D-006, D-014, delivery flow (D-016, blueprint §10). |
| P-5 | 2026-11-25 | **Rules/blueprint split:** rewrite `CLAUDE.md` with a given rules-only text and move everything project-specific into `docs/BLUEPRINT.md`. Use `AI_USAGE.md` for AI notes. | `CLAUDE.md` rewritten as rules only, blueprint created as the single source of truth (D-015). |
| P-6 | 2026-11-25 | **Swappable search design:** split `ProductProvider` into `ProductRepository` (source of truth) and `ProductSearchEngine` (capabilities, `search → { ids, total }`, `index`). `GET /products` takes the full query, and unsupported filters/sorts get a 400. The in-memory engine supports only `q`, `category` and paging. On iOS, `ProductQuery` has every field optional. A test with a fake all-capable engine proves plug-and-play. | Search behind a capability contract (D-008, blueprint §5.7, §6.4). |
| P-7 | 2026-11-25 | Blueprint review. Accepted both open questions and all proposed decisions, then changed several things:<br>• **Stale fallback:** after the TTL, refetch; if Fake Store fails, serve the last good copy and log a warning; 502 only with no copy.<br>• **Testable capabilities:** `InMemorySearchEngine` supports every filter and sort, with capabilities injected through its constructor so tests can limit them; unsupported params → 400 plus a logged warning.<br>• **Image proxy guards:** host allowlist, `image/*` only, timeout, max size, cache headers, a test each.<br>Also: search matches category text, iOS 18 minimum, and new decisions on stack choice, single coordinator and store-vs-search latency. | Blueprint v0.2 (§5.5–§5.7, §5.10, §6.4, §6.6, §7.1, §8.4, §9.1, §12). D-001, D-007, D-008, D-011 and D-013 updated. D-025, D-026 and D-027 added. "Dropped or simplified", "How it grows" and "What I'd do next" sections added to `DECISIONS.md`. |
| P-8 | 2026-11-25 | Kept the AI's extra hardening (no redirects on image fetches, `nosniff`, a separate `IMAGE_TIMEOUT_MS`). Replaced its "no maximum stale age" with a **24 h cap**. Gave the go-ahead for backend work. | `PRODUCT_STALE_MAX_AGE_SECONDS` (blueprint v0.3, D-011). |
| P-9 | 2026-11-25 | Backend review, done by comparing the blueprint with the code, service by service. Asked for:<br>• the blueprint drift fixed, text only;<br>• a **retry back-off** so requests during an outage stop each waiting for the 5 s timeout;<br>• images limited to **JPEG/PNG/WebP/GIF** (no SVG);<br>• a note that one malformed upstream product rejects the whole catalogue;<br>• `GET /products` to treat **present-but-empty params as 400**, with the iOS side never sending empty values;<br>• §5.10 to mark required vs default variables. | Blueprint v0.5 (drift) and v0.6. `CACHE_RETRY_BACKOFF_SECONDS`, image type allowlist, D-028, updates to D-001 and D-011, §6.4 / §7.5 / §7.8 rules, new tests. |

## Where the AI got something wrong and how it was caught

| # | Date | What was wrong | How it was caught | Fix |
|---|---|---|---|---|
| W-1 | 2026-11-25 | **Blueprint drift.** The AI committed blueprint v0.4 as a "backend implementation sync" but missed four mismatches with the code:<br>• `Logger` lacked `debug`;<br>• the repository was described as receiving "a clock and image cache limits" instead of two `TtlCache` instances;<br>• the narrow `MailTransport` interface was missing;<br>• test helpers were listed under `test/mocks/`, and the fixtures were said to include images. | The developer compared the blueprint with the code section by section during review. | Blueprint v0.5, text only. Lesson: after implementing, diff every blueprint section the code touches rather than only the file tree. |
| W-2 | 2026-11-25 | **Outage latency.** The stale fallback retried upstream on every request after the TTL. During an outage, every request waited for the full 5 s timeout before getting the stale copy. The tests checked what was returned, not how long it took or how many upstream calls were made. | Developer review of the cache behaviour. | Retry back-off (`CACHE_RETRY_BACKOFF_SECONDS`), with tests asserting that no upstream call happens inside the window. |
