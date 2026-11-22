# CLAUDE.md — Coding Rules

These are rules for *how* to write code in this repo. *What* to build lives in the blueprint, [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md). It works like a PRD: requirements, architecture, API contract, config and test coverage.

The blueprint is a living document. When a requirement is unclear, ask me, then update the blueprint with the answer before writing the code. Build against the blueprint, and do not change the API contract without asking. Keep the blueprint, `DECISIONS.md` and `docs/ai-notes.md` current as the work progresses.

## 1. Boundaries
- The iOS client talks only to our backend. Never call `fakestoreapi.com` (or any third-party API) from Swift.
- Route handlers depend only on the `ProductProvider` and `EmailService` interfaces. Never import concrete adapters (`FakeStoreProvider`, `nodemailer`, SMTP code) in `src/routes/`.
- Concrete adapters are instantiated only in `src/container.ts`. Nothing else uses `new` on an adapter.
- Business rules (e.g. "top rated" selection) go in pure functions under `src/domain/`, not in route handlers or adapters.
- Read environment variables only in `src/config.ts`. Everything else receives config as arguments.
- Never hardcode values that belong in config (URLs, email addresses, featured IDs, timeouts).

## 1a. Dependency injection (backend and iOS)
- Pass dependencies in through constructors/initializers (or factory parameters such as `createApp(deps)`). Depend on protocols/interfaces, not concrete types.
- No singletons (`.shared`, module-level instances), service locators or global mutable state.
- Each side has exactly one composition root that creates the concrete graph: `backend/src/container.ts`, and `AppDependencies` on iOS (with `AppCoordinator` creating screens and ViewModels from it). Nothing else creates concrete services or clients.

## 2. TypeScript (backend)
- `"strict": true`. No `any`; use `unknown` and narrow it.
- Keep `src/app.ts` (app creation) separate from `src/server.ts` (startup) so the app can be tested without a network port.
- Prefer small, single-purpose modules and named exports.
- Use `async`/`await`; never leave a promise unhandled.

## 3. Validation, errors and security
- Validate every input at the route boundary with a schema before it reaches domain code. Reject unknown fields.
- Reject CR/LF in any user value that ends up in an email header.
- Never put user input into HTML; emails are plain text.
- All errors go through one error-handling middleware that returns the error envelope from the blueprint.
- Never leak stack traces, internal hostnames or upstream error bodies in responses. Log them server-side instead.
- Never commit `.env` files, keys or tokens. Add new config to `.env.example` with a safe default.
- Do not add paid services or anything a reviewer would need an account for.

## 4. Swift / SwiftUI (iOS)

### MVVM-C layering
- Strict direction: View → ViewModel → Service protocol → `NetworkClient`. No layer skips another or calls upwards.
- **Views** only render state and forward user intents. No networking, business logic, navigation decisions or data formatting beyond display. Each screen view holds its ViewModel in `@State`, initialised once via `_viewModel = State(initialValue:)`.
- **ViewModels** are `@Observable` and `@MainActor`. They receive service protocols and a `CatalogueNavigating` navigator through `init`, expose a `ViewState<T>` and a retry action, and never import SwiftUI view types or touch `URLSession`.
- **Services** receive a `NetworkClient` through `init`, call endpoints and return domain models. They do not hold UI state.

### Coordinator
- `AppCoordinator` is the only owner of navigation state (`path: [Route]`, `sheet: Sheet?`). No `NavigationLink(destination:)`, `isPresented` flags or navigation state in views or ViewModels.
- ViewModels navigate only by calling `CatalogueNavigating` methods (e.g. `navigator.showProduct(id:)`). They never reference `AppCoordinator`, `Route` or other screens directly.
- `AppCoordinator` is the only place that creates screens and ViewModels. New screens get a `Route` (or `Sheet`) case plus a factory branch in the coordinator.
- Keep a single coordinator. Do not add child coordinators unless a flow clearly needs one, and ask first.

### Networking
- All HTTP goes through the central `NetworkClient`. Nothing else uses `URLSession`, `URLRequest` or `JSONDecoder` for network calls.
- Define requests as `Endpoint` values in `Endpoints.swift`. Build URLs with `URLComponents` and `URLQueryItem`, never by string concatenation.
- `NetworkClient` maps every failure to a typed `APIError`. ViewModels turn `APIError` into user-facing messages and never show raw errors.

### Configuration and DI
- `AppConfiguration` is loaded once at launch from `Info.plist` (`API_BASE_URL`). Never hardcode the backend URL or timeouts in Swift source.
- `AppDependencies` is built once in the `@main` `App` from `AppConfiguration` and injected into `AppCoordinator`. Views never reach for dependencies themselves.
- Previews build screens with mock ViewModels; tests use `AppDependencies.mock`, mock services and a mock navigator, never the live client.

### UI
- Never hardcode colors, fonts, corner radii or padding in views; use `AppTheme` tokens.
- Every network-backed screen handles four states: Loading, Loaded, Empty, and Error (with Retry).
- Search runs on explicit submit (`.onSubmit(of: .search)`), not on every keystroke.

### General
- Use Swift Concurrency (`async`/`await`). No completion handlers or Combine for networking.
- No third-party dependencies.

## 5. Testing
- Every behaviour change comes with a test.
- Tests never hit the real network. Use injected mocks for `ProductProvider` / `EmailService` and recorded JSON fixtures for adapter tests. On iOS, test `NetworkClient` with a stub `URLProtocol`, services with a mock `NetworkClient`, ViewModels with mock service protocols and a mock navigator, and `AppCoordinator` by asserting on `path` / `sheet`.
- Test behaviour through public interfaces (HTTP via Supertest, ViewModel state), not private implementation details.
- A test must be able to fail. Check that it fails when the behaviour is broken.

## 6. Working rules
- Work on a feature branch, never directly on `main`. Make small, focused commits with descriptive messages.
- Run the relevant tests before declaring a task done, and report failures honestly.
- Do not add dependencies, endpoints or features that are not in `docs/BLUEPRINT.md` without asking first. If I agree, update the blueprint in the same change.
- When a decision fills a gap in the acceptance criteria, add it to `DECISIONS.md`.
- When I correct a mistake you made, append a short entry to `docs/ai-notes.md` saying what was wrong and how it was caught.
