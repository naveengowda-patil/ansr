# Product Catalogue

A proof of concept for a product catalogue: a SwiftUI iOS app and a Node.js + TypeScript (Express) backend. The app only talks to our backend. The backend reads products from [Fake Store](https://fakestoreapi.com) (images included) and sends enquiry emails, which Mailpit catches locally.

## Why this stack

- **iOS: SwiftUI**, with the UIKit app lifecycle. It's my strongest platform, so the time went into the architecture the real product grows from (MVVM-C, protocols at every boundary, tests without a network) rather than into learning a stack.
- **Backend: Node.js + TypeScript + Express.**
  - **Node.js:** the backend mostly waits on other services (Fake Store, the image proxy, email), which Node's non-blocking I/O handles well.
  - **TypeScript** in strict mode, with `zod` at the boundaries, catches contract mistakes at compile time and rejects bad input at run time.
  - **Express** is small and easy to read, with middleware for validation and one error handler.
  - It ships as one small container that runs on ECS Fargate or App Runner (or on Lambda with an adapter, since Express expects a long-running server).
- **Mailpit** catches emails locally, so nothing needs an account or costs money.

NestJS felt too heavy for a proof of concept, and Laravel would add a PHP toolchain for the reviewer. The full reasoning is in [D-025](DECISIONS.md#d-025--stack-choice).

## Docs

- [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md): the single source of truth for what is built (requirements, architecture, API contract, config, tests)
- [`docs/BACKEND_ARCHITECTURE.md`](docs/BACKEND_ARCHITECTURE.md): a guide to the backend, part by part, linking to the blueprint
- [`docs/FRONTEND_ARCHITECTURE.md`](docs/FRONTEND_ARCHITECTURE.md): a guide to the iOS app, part by part, linking to the blueprint
- [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md): a quick reference for API callers
- [`DECISIONS.md`](DECISIONS.md): why things are the way they are
- [`AI_USAGE.md`](AI_USAGE.md): my five most important prompts and the AI's five most important mistakes
- [`docs/PROMPT_LOG.md`](docs/PROMPT_LOG.md): every prompt that shaped the work, with the decision it led to, plus the AI tools and setup and the smaller corrections

## Prerequisites

- **Docker with Compose 2.24 or newer**, from Docker Desktop, OrbStack or Colima (check with `docker compose version`)
- **Xcode 16 or newer** for the iOS app (built with Xcode 26), plus an iOS 18+ simulator. Xcode 16 is the minimum because the iOS 18 deployment target and the project format need it.
- *Optional:* Node.js 24 (see `backend/.nvmrc`), only if you want to run backend tests outside Docker

## Quick start

One command from a fresh clone, with nothing to copy:

```bash
docker compose up --build
```

`.env.example` holds safe defaults and is used as-is. A `.env` is **optional, for overrides only**. If it exists, anything it sets wins, for example `PORT=3100` or `LOG_LEVEL=debug`.

| What | Where |
|---|---|
| API | http://localhost:3000 (check with http://localhost:3000/health) |
| Mailpit inbox, where enquiry emails land | http://localhost:8025 |

Try it:

```bash
curl http://localhost:3000/products/featured
curl "http://localhost:3000/products?q=jacket"
curl -X POST http://localhost:3000/enquiries -H 'content-type: application/json' \
  -d '{"productId":3,"name":"Jane Doe","email":"jane@example.com","message":"Do you ship to Ireland?"}'
```

Then open http://localhost:8025 to see the email.

### iOS app

With the backend running:

1. Open `iOS/ANSR/ANSR.xcodeproj` in Xcode.
2. Choose the **`ANSR Debug`** scheme and an iPhone simulator with **iOS 18 or newer**. The app was developed and tested on **iPhone 16, iOS 18.2**. If you have no iOS 18+ simulator, add one in Xcode → Settings → Components.
3. Press **⌘R**. The first build takes about 15 seconds on an Apple M2, and later ones are quicker. Home then shows the top rated products and the categories from the local backend.

There are no packages to download and no signing team to pick: the app has no third-party dependencies and runs on the simulator only, so no Apple developer account is needed. `ANSR Debug` points at `http://localhost:3000`. `ANSR Prod` points at a placeholder HTTPS address, so it shows Home's error state until a real environment exists.

### How long it takes

Timed from a fresh clone on an Apple M2 with 8 GB of memory:

| Step | Time |
|---|---|
| `docker compose up --build`, until `/health` answers | 21 s (20 s to build with no cache, then 1 s to healthy) |
| First Xcode build of `ANSR Debug` | 15 s |
| First launch in the simulator, until Home shows products | about 2 s, and every image within about 5 s |

Docker, Xcode 26.4 and an iOS 18.2 simulator were already installed, and Docker already had the two base images. On a first-ever run, Docker also downloads `node:24-alpine` and `axllent/mailpit` (about 77 MB together). If Xcode has no iOS 18+ simulator yet, installing one is a separate, larger download (Xcode → Settings → Components). With those in place, a fresh clone is up and running in a few minutes, most of it spent opening Xcode.

## API at a glance

The full contract is in blueprint §6. Every error uses `{ "error": { "code", "message" } }`, with one of these codes: `VALIDATION_ERROR` 400, `NOT_FOUND` 404, `UPSTREAM_ERROR` 502, `INTERNAL_ERROR` 500.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness check |
| `GET /products/featured` | 5 featured products (AC-1) |
| `GET /products?q=&category=&minPrice=&maxPrice=&minRating=&sort=&page=&pageSize=` | Search and listing (AC-3) |
| `GET /products/{id}` | Product details (AC-4) |
| `GET /products/{id}/image` | Product image, proxied |
| `GET /categories` | Category names |
| `GET /categories/{category}` | `{ topRated, rest }` for a category (AC-2) |
| `POST /enquiries` | Send an enquiry to the sales inbox (AC-5) |

## Running tests

**Backend** with Node 24:

```bash
cd backend && npm ci && npm test
```

With Docker only, no local Node needed:

```bash
docker build --target test backend
```

**iOS:** press ⌘U in Xcode with the `ANSR Debug` scheme, or from the repository root:

```bash
xcodebuild test -project iOS/ANSR/ANSR.xcodeproj -scheme "ANSR Debug" -destination "platform=iOS Simulator,name=iPhone 16,OS=18.2"
```

Use an iPhone and iOS version you have installed (`xcrun simctl list devices available` lists them). Give both `name` and `OS`: without `OS`, xcodebuild looks only at the newest iOS runtime, which may not have that iPhone. The iOS tests use test doubles and never call the backend, so it doesn't need to be running.

## Time spent

| Planning | Building | Testing | Reviewing | Total |
|---|---|---|---|---|
| ~5 h | ~3 h | ~0.5 h | ~4 h | **~12.5 h** |

Building is counted from the code commits, at about 5 minutes each; most tests were written inside those commits. That's well over the 2–3 hour time-box. Most of the extra time went into planning (the blueprint and the decisions, before any code) and reviewing (checking every change and walking through each acceptance criterion on the simulator), not into building.

## Configuration

All settings are environment variables. They are listed with safe defaults in [`.env.example`](.env.example), which Docker Compose loads directly, and documented in blueprint §5.10. Put any overrides in an optional `.env`: it is git-ignored and loaded after `.env.example`. To run the API outside Docker (`cd backend && npm run dev`), which reads the same two files, set `SMTP_HOST=localhost` in `.env`.

## Troubleshooting

- **Port 3000, 8025 or 1025 already in use:** stop whatever is using it, or set `PORT` in a `.env`. Mailpit's ports are set in `docker-compose.yml`.
- **Compose complains about `env_file` / `path` / `required`:** your Docker Compose is older than 2.24. Update Docker Desktop (or your Compose plugin).
- **`docker: command not found` with Docker Desktop installed:** add `~/.docker/bin` to your `PATH`, or enable the CLI tools in Docker Desktop → Settings → Advanced.
- **The API returns 502 `UPSTREAM_ERROR`:** Fake Store is unreachable and there's no cached copy less than 24 hours old. Check your internet connection. The API logs show the reason.
- **The simulator can't reach the backend:** make sure `docker compose ps` shows `api` as healthy, and that the `ANSR Debug` scheme is selected (`ANSR Prod` can't reach a local backend).
- **`xcodebuild` says "Unable to find a device matching the provided destination specifier":** the `name` and `OS` in `-destination` must match an installed simulator. Run `xcrun simctl list devices available` and use one from that list.
