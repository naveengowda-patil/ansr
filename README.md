# Product Catalogue

A proof of concept for a product catalogue: a SwiftUI iOS app and a Node.js + TypeScript (Express) backend. The app only talks to our backend. The backend reads products from [Fake Store](https://fakestoreapi.com) (images included) and sends enquiry emails, which Mailpit catches locally.

- **What is built, and how:** [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md), the single source of truth
- **Why:** [`DECISIONS.md`](DECISIONS.md)
- **How AI was used:** [`AI_USAGE.md`](AI_USAGE.md)

## Prerequisites

- **Docker with Compose v2**, from Docker Desktop, OrbStack or Colima
- **Xcode 16 or newer** for the iOS app (built with Xcode 26), plus an iOS 18+ simulator. Xcode 16 is the minimum because the iOS 18 deployment target and the project format need it.
- *Optional:* Node.js 24 (see `backend/.nvmrc`), only if you want to run backend tests outside Docker

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

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

*Added in the iOS PR.* Open `ios/Catalogue.xcodeproj`, pick an iPhone simulator and Run. The Debug configuration points at `http://localhost:3000`.

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

**iOS:** press ⌘U in Xcode. *(Added in the iOS PR.)*

## Configuration

All settings are environment variables. They are listed with safe defaults in [`.env.example`](.env.example) and documented in blueprint §5.10. To run the API outside Docker (`cd backend && npm run dev`), set `SMTP_HOST=localhost` in `.env`.

## Troubleshooting

- **Port 3000, 8025 or 1025 already in use:** stop whatever is using it, or change `PORT` in `.env`. Mailpit's ports are set in `docker-compose.yml`.
- **`docker: command not found` with Docker Desktop installed:** add `~/.docker/bin` to your `PATH`, or enable the CLI tools in Docker Desktop → Settings → Advanced.
- **The API returns 502 `UPSTREAM_ERROR`:** Fake Store is unreachable and there's no cached copy less than 24 hours old. Check your internet connection. The API logs show the reason.
- **The simulator can't reach the backend:** make sure `docker compose ps` shows `api` as healthy.
