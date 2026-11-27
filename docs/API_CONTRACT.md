# API contract: quick reference

A one-page reference for anyone calling the backend: the iOS app now, other clients later.

> **The full rules live in [`BLUEPRINT.md` §6](BLUEPRINT.md#6-api-contract), the single source of truth.** Each endpoint below links to its section. This page summarises the contract and adds no rules of its own. If the two disagree, the blueprint wins.

## Basics

- **Base URL:** `http://localhost:3000` locally. There is no version prefix in the proof of concept.
- **Format:** JSON in and out. The one exception is `GET /products/{id}/image`, which returns image bytes.
- **Clients only call this API.** Product data and images never come from Fake Store directly. Every product image is served by the backend at `/products/{id}/image`.
- **Unknown fields and query parameters are rejected with 400**, and so are repeated and present-but-empty query parameters.

## Product

Returned by every endpoint that returns products. Rules: [§6.1](BLUEPRINT.md#61-product-response-shape).

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

There is no image URL in the payload. The image is always at `GET /products/{id}/image`.

## Errors

Every error uses the same envelope. Rules: [§5.9](BLUEPRINT.md#59-errors).

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable, safe message." } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | The request is invalid: bad or unknown params or fields, malformed JSON, a body that's too large, or an unsupported search filter or sort |
| `NOT_FOUND` | 404 | Unknown route, product or category |
| `UPSTREAM_ERROR` | 502 | The product source or the email provider failed; safe to retry later |
| `INTERNAL_ERROR` | 500 | Anything unexpected |

These four codes are the complete set. Messages never contain stack traces or upstream details.

## Endpoints

| Method | Path | Returns (200) | Main errors | Rules |
|---|---|---|---|---|
| `GET` | `/health` | `{ "status": "ok" }`. Liveness only; it never calls upstream services. | none | [§6.2](BLUEPRINT.md#62-get-health) |
| `GET` | `/products/featured` | `{ "items": Product[] }`: up to 5 featured products (AC-1) | 502 | [§6.3](BLUEPRINT.md#63-get-productsfeatured-ac-1) |
| `GET` | `/products` | `{ "items": Product[], "total", "page", "pageSize" }`: search and listing (AC-3) | 400 (validation or unsupported param), 502 | [§6.4](BLUEPRINT.md#64-get-products-ac-3-search-and-listing) |
| `GET` | `/products/{id}` | `Product` (AC-4) | 400 (invalid id), 404, 502 | [§6.5](BLUEPRINT.md#65-get-productsid-ac-4) |
| `GET` | `/products/{id}/image` | The image bytes (JPEG, PNG, WebP or GIF), with `Cache-Control` and `X-Content-Type-Options: nosniff` | 400, 404, 502 | [§6.6](BLUEPRINT.md#66-get-productsidimage) |
| `GET` | `/categories` | `{ "items": string[] }`: category names | 502 | [§6.7](BLUEPRINT.md#67-get-categories) |
| `GET` | `/categories/{category}` | `{ "category", "topRated": Product[], "rest": Product[] }` (AC-2). Matches case-insensitively, and `category` comes back spelled as in the data. | 404, 502 | [§6.8](BLUEPRINT.md#68-get-categoriescategory-ac-2) |
| `POST` | `/enquiries` | `{ "status": "sent" }` once the email has been accepted (AC-5) | 400, 404 (unknown product), 502 (email or product source) | [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5) |

### Notes for callers

- **Search today is text search only.**
  - `GET /products` accepts `q`, `sort=relevance`, `page` and `pageSize`.
  - `category`, `minPrice`, `maxPrice`, `minRating` and the other sorts are part of the contract, but the running app answers them with 400 `VALIDATION_ERROR` naming the parameter. They are built and unit-tested, and will be enabled without a contract change. See [§6.4](BLUEPRINT.md#64-get-products-ac-3-search-and-listing).
  - Don't send empty parameters (for example `?q=`); omit them instead.
- **`POST /enquiries` body:**
  - `productId` is a positive integer JSON number (`7`, never `"7"` or `7.5`).
  - `name` and `email` are required, `message` is optional, and unknown fields are rejected.
  - The exact limits are in [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5).
- **Path parameters:** URL-encode category names, for example `/categories/men's%20clothing`.
- **Retrying:** a 502 means a dependency failed, and it's reasonable to retry later. A 400 won't succeed if retried unchanged.
