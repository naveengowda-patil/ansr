# AI Usage

This file covers how AI was used to build this project, which prompts shaped it, and where the AI got things wrong.

## Key moments

The five prompts and catches that shaped the solution most. Every prompt is in the [prompt log](docs/PROMPT_LOG.md), and every correction is in [the last section](#where-the-ai-got-something-wrong-and-how-it-was-caught).

1. **Rules in `CLAUDE.md`, the design in one blueprint** ([P-5](docs/PROMPT_LOG.md), D-015). I rewrote `CLAUDE.md` as stack-agnostic rules for *how* to work and moved everything project-specific into `docs/BLUEPRINT.md`, the single source of truth: every change is a blueprint edit first, then code. This set how every later prompt worked, and it is why the code, the docs and this log stayed in step across 28 blueprint versions.
2. **Every product, and every image, only through our backend** ([P-1](docs/PROMPT_LOG.md), D-001). Fake Store, the email provider and the look and feel will all change, so each sits behind a boundary, and the app never calls Fake Store, not even for images. The backend proxies images by product id, never by URL, and only from an allowlisted host. That one rule produced the image proxy, its SSRF guards and the app's image cache.
3. **Search as a swappable engine with declared capabilities** ([P-6](docs/PROMPT_LOG.md), then W-3, D-008). Search was split from the product store: an engine returns ids and declares what it supports, and anything it doesn't support is a 400 naming it, never a silently wrong answer. In review I found the AI had also switched every filter and sort on in the running app, beyond what AC-3 needs. The running app was narrowed to text search, with capabilities always explicit, so a real engine can plug in without changing a route or the app.
4. **MVVM-C with one navigator protocol per view model** ([P-2](docs/PROMPT_LOG.md), [P-16](docs/PROMPT_LOG.md), D-026, D-032). One coordinator builds every screen and owns navigation, and each view model gets a small protocol listing only the moves it may make. Views are dumb and view models are tested through those protocols, with no network. This is what made the screens' behaviour testable without UI tests.
5. **The AI's explanation didn't match the code** (W-4). The AI described the email service as failing fast with a 502, but no SMTP timeouts were configured, so a hanging mail server could have held an enquiry for minutes. I caught it by checking the explanation against `container.ts`. It led to `SMTP_TIMEOUT_MS` with a test against a silent local server, and to a habit kept for the rest of the project: an explanation is a claim to verify against the code, not a description of it.

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

## Prompt log

Every prompt that shaped the work, 26 so far, is in [`docs/PROMPT_LOG.md`](docs/PROMPT_LOG.md). The key moments above are the five that mattered most.

## Where the AI got something wrong and how it was caught

| # | Date | What was wrong | How it was caught | Fix |
|---|---|---|---|---|
| W-1 | 2026-11-25 | **Blueprint drift.** The AI committed blueprint v0.4 as a "backend implementation sync" but missed four mismatches with the code:<br>• `Logger` lacked `debug`;<br>• the repository was described as receiving "a clock and image cache limits" instead of two `TtlCache` instances;<br>• the narrow `MailTransport` interface was missing;<br>• test helpers were listed under `test/mocks/`, and the fixtures were said to include images. | The developer compared the blueprint with the code section by section during review. | Blueprint v0.5, text only. Lesson: after implementing, diff every blueprint section the code touches rather than only the file tree. |
| W-2 | 2026-11-25 | **Outage latency.** The stale fallback retried upstream on every request after the TTL. During an outage, every request waited for the full 5 s timeout before getting the stale copy. The tests checked what was returned, not how long it took or how many upstream calls were made. | Developer review of the cache behaviour. | Retry back-off (`CACHE_RETRY_BACKOFF_SECONDS`), with tests asserting that no upstream call happens inside the window. |
| W-3 | 2026-11-25 | **Search over-enabled.**<br>• **Intended:** the `GET /products` contract and the engine interface ready for a *future* search engine that supports filters and sorts. The current in-memory engine only needed text search.<br>• **What happened:** during planning, the AI recommended making the in-memory engine support every filter and sort as well, and that recommendation went into the developer's prompt ([P-7](docs/PROMPT_LOG.md)). The engine was built that way and enabled in the running app, beyond what was intended and beyond AC-3. | The developer reviewed the search engine against their original intent. | Blueprint v0.8 / D-008. The running app does text search only: `textSearchOnly()`, explicit in `container.ts` and the engine default. The extra filters and sorts are kept as "additional, built and unit-tested, not enabled in the running app", because they're useful once a real engine is plugged in. Route tests assert a 400 plus a warning for each one. **Lesson:** check AI recommendations against the original intent before they go into a prompt. |
| W-4 | 2026-11-25 | **Explanation didn't match the code.** The AI explained the email service as: SMTP timeouts become a 502, and requests take milliseconds. But no SMTP timeouts were configured, so nodemailer's defaults applied: 2 min to connect, 30 s for the greeting, 10 min of socket inactivity. A hanging mail server could stall an enquiry for minutes. | The developer checked the explanation against `container.ts`. | `SMTP_TIMEOUT_MS` (default 10 s) on all three timeouts. A container test checks the transport receives it, and an adapter test runs a real nodemailer transport against a silent local server and gets `UpstreamError`. **Lesson:** an explanation of behaviour is a claim to verify against the code, not a description of it. |
| W-5 | 2026-11-26 | **Timing-based test.** The AI's end-to-end logging test (`test/logging.test.ts`) used real sleeps: 1.05 s to let a 1 s TTL expire and 50 ms for the background refresh, in each of 3 tests (about 3.5 s). That broke the project's "no timing-based tests" approach and could turn flaky in CI. The AI had noted the slowdown but shipped it anyway. | The developer's review of the test suite. | The container takes an optional `now` clock and exposes `whenIdle()`. The test moves a fake clock past the TTL and awaits `container.whenIdle()`, with no `setTimeout` left in it. Blueprint v0.12. **Lesson:** if a test needs to wait, inject the clock or await the work. Never sleep. |
| W-6 | 2026-11-27 | **A fix that swallowed another control's input.** For the phase 2.6 Cancel fix, the AI put back every write to the results screen's field while search mode was off, which covered the system's second `""` on Cancel. It didn't check the field's other control that writes `""`: the ✕ outside search mode writes it before search mode starts, so that write was put back as well, and clearing took two taps instead of one. The tests only drove Cancel and typing. | The developer tapped the ✕ on a results screen while testing 2.6. | Blueprint v0.27 / D-044: after a Cancel, only the system's one extra `""` is put back; other writes are kept. Tests for the ✕ outside search mode and after a Cancel. **Lesson:** a rule that filters writes from the system has to be checked against every control that makes the same write, not only the one being fixed. |
