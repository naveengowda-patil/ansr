# Frontend architecture

A reader's guide to the iOS app: what each part does, where it lives, and how the parts fit together.

> **The exact rules live in [`BLUEPRINT.md` §7](BLUEPRINT.md#7-ios-app), the single source of truth.** This guide explains and links to it. It doesn't define rules of its own. If the two ever disagree, the blueprint wins, and the mismatch should be raised.

The app is a SwiftUI iPhone app (iOS 18) built as MVVM-C. Its only data source is our backend: products, categories, images and enquiries all go through it, never to Fake Store directly. File paths below follow the planned layout in [§7.2](BLUEPRINT.md#72-structure).

```
 SceneDelegate ──▶ 1. Launch + configuration (AppBootstrapper → AppConfiguration, AppDependencies, AppCoordinator)
                                                      │
                         6. Navigation (AppCoordinator: path + sheet, builds every screen)
                                                      │
      7. Screens:  View ──intents──▶ ViewModel ──▶ 4. Repositories ──▶ 3. Networking ──HTTP──▶ backend
                    ▲                    │                                ▲
                    └── view data ───────┤                                │
                                         └──▶ 5. Image provider ──────────┘ (memory → disk → network)

 2. Build setup and schemes: Debug / Prod xcconfig → Info.plist → AppConfiguration
 8. Shared UI and theme: ViewState, StateContainerView, tiles, Strings, Formatters, AppTheme
```

The arrows only go one way. A layer talks only to the protocol of the layer below it, and only the composition root (section 1) knows the concrete types. Rules: [§7.3](BLUEPRINT.md#73-mvvm-c-layering-and-models).

---

## 1. Launch and configuration

**The start-up sequence. It reads the build settings once, builds every dependency, and puts Home on screen, or a clear error if the settings are wrong.**

- **Files:**
  - `ANSR/App/AppDelegate.swift`, `SceneDelegate.swift`, `AppBootstrapper.swift`
  - `ANSR/App/AppConfiguration.swift`, `AppDependencies.swift`, `ConfigurationErrorView.swift`
  - `ANSR/Info.plist`
  - `ANSR/Mocks/` (`AppDependencies.mock`, for previews)
- **Public API:**
  - `AppBootstrapper.configure()` returns `.ready(AppCoordinator)` or `.configurationError(message)`.
  - `AppConfiguration` has `apiBaseURL` and `requestTimeout`, built from the info dictionary. It throws when a value is missing or invalid.
  - `AppDependencies.live(_:)` is the composition root. `AppDependencies.mock` is for previews.
- **How it works:**
  - **Lifecycle:** the app uses the UIKit lifecycle and hosts SwiftUI.
    1. `@main AppDelegate` declares the scene.
    2. `SceneDelegate` creates the window and calls the bootstrapper.
    3. It shows the coordinator's root view, or `ConfigurationErrorView`.
  - **The bootstrapper** does three steps: load the configuration, build the dependencies, build the coordinator. It makes no network calls, so the first frame is never delayed.
  - **No splash screen:** Home's spinner is the launch state.
  - **No refresh** when the app returns from the background.
  - **`AppDependencies`** exposes protocols only: the three repositories and the image provider, plus the theme and the locale. `live(_:)` is the only place concrete types are created.
- **Config used:** `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS` from `Info.plist` (section 2).
- **Hosting tests:** when the app is only there to host the unit tests, the bootstrapper builds nothing, so a test run never calls the backend ([D-043](../DECISIONS.md)).
- **Tests:** `AppBootstrapper` tests cover the test-host case and a bad URL. The rest of the bootstrap is covered by the manual walkthrough.
- **Rules:**
  - [§7.7](BLUEPRINT.md#77-launch-configuration-and-di) (launch, configuration, DI)
  - [D-030](../DECISIONS.md) (lifecycle and bootstrapper)

## 2. Build setup and schemes

**Which settings the app is built with, and how a scheme picks the backend it talks to.**

- **Files:**
  - `iOS/ANSR/ANSR.xcodeproj` (targets `ANSR` and `ANSRTests`, shared schemes `ANSR Debug` and `ANSR Prod`)
  - `iOS/ANSR/Config/Debug.xcconfig` and `Prod.xcconfig`
- **How it works:**
  - **Language:** Swift 6 with strict concurrency.
    - Code is `nonisolated` by default, and UI types are marked `@MainActor` explicitly.
    - Approachable Concurrency is off, so background work such as decoding stays off the main actor.
  - **Project:**
    - Swift Testing for unit tests, with no UI test target.
    - No third-party dependencies.
    - No development team: it runs on the simulator only.
  - **`Info.plist`:** the app's own file is merged with the one Xcode generates. It carries the two settings and the scene manifest. The plain-HTTP exception is kept in Debug builds only, by preprocessing the file ([§7.1](BLUEPRINT.md#71-stack-and-project-setup), [D-042](../DECISIONS.md)).
  - **Configurations:**
    - **Debug** points at the local backend and allows plain HTTP to localhost.
    - **Prod** points at a placeholder HTTPS URL and allows HTTPS only.
    - Each comes from its xcconfig, through `Info.plist`, into `AppConfiguration`.
  - **Schemes:** both are shared, so a fresh clone has them.
- **Config used:** `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS`, with the values in the blueprint's table.
- **Tests:** test actions run on Debug.
- **Rules:**
  - [§7.1](BLUEPRINT.md#71-stack-and-project-setup) (stack and settings)
  - [§7.7](BLUEPRINT.md#77-launch-configuration-and-di) (configurations and schemes)
  - [§8.2](BLUEPRINT.md#82-run-target-under-10-minutes) (how to run)
  - [D-039](../DECISIONS.md), [D-013](../DECISIONS.md)

## 3. Networking

**The phone line to the backend. Every request, images included, goes through one client that builds the URL, sends it and turns the answer or the failure into something typed.**

- **Files:** `ANSR/Networking/`
  - `NetworkClient.swift` and `URLSessionNetworkClient.swift`
  - `Endpoint.swift` and `Endpoints.swift`
  - `APIError.swift` and `ErrorEnvelope.swift`
  - `ANSR/Shared/ErrorMessages.swift`
- **Public API:**
  - `NetworkClient`:
    - `send(_:as:)` for JSON;
    - `data(for:)` for raw bytes (images).
  - `Endpoints`: `featured`, `products(_:)`, `product(id:)`, `productImage(id:)`, `categories`, `category(name:)` and `createEnquiry(_:)`.
  - `APIError` and `ErrorMessages.message(for:)`.
- **How it works:**
  - **Requests:** `Endpoints` builds each request from `URLComponents`.
    - It never sends an empty value, so a blank search term is simply left out.
    - The enquiry's `productId` is a Swift `Int`, so it's always a JSON number.
  - **Errors:** the client maps the backend's error envelope and `URLError`s into `APIError`. Leaving a screen gives `.cancelled`, which is never shown.
    - `ErrorMessages` turns everything else into friendly text, and raw errors never reach the screen.
  - **Offline:** the session fails fast when offline instead of waiting for a connection.
  - **No HTTP cache:** the session has none, because images are cached by section 5.
- **Config used:** `API_BASE_URL` and `REQUEST_TIMEOUT_SECONDS`, via `AppConfiguration`.
- **Tests:** network client tests with a stub `URLProtocol`. They check that search sends only non-empty params and that each error maps correctly.
- **Rules:**
  - [§7.5](BLUEPRINT.md#75-networking) (client, endpoints, `APIError`, messages)
  - [§6](BLUEPRINT.md#6-api-contract) (the API; quick reference in [`API_CONTRACT.md`](API_CONTRACT.md))

## 4. Repositories

**The app's view of the backend. Each one answers a question a screen asks ("featured products?", "this category?") by calling one endpoint.**

- **Files:** `ANSR/Repositories/`
  - `ProductRepository` / `RemoteProductRepository`
  - `CategoryRepository` / `RemoteCategoryRepository`
  - `EnquiryRepository` / `RemoteEnquiryRepository`
  - The data models are in `ANSR/Models/`.
- **Public API:**
  - `ProductRepository`: `featured()`, `search(_:)` and `product(id:)`.
  - `CategoryRepository`: `categories()` and `category(_:)`.
  - `EnquiryRepository`: `submit(_:)`.
- **How it works:**
  - **Naming:** the protocol says the role and the concrete type says how.
  - **The `Remote…` types:** each method calls one endpoint through `NetworkClient` and returns the data models (`Product`, `CategoryProducts`, `ProductPage` and so on). They hold no cache and no UI state.
  - **Only what's needed:** each view model receives only the repositories it uses.
- **Config used:** none directly.
- **Tests:** view model tests use recording test doubles of these protocols.
- **Rules:**
  - [§7.10](BLUEPRINT.md#710-repositories) (protocols and who gets what)
  - [§7.3](BLUEPRINT.md#73-mvvm-c-layering-and-models) (data models, naming)
  - [D-033](../DECISIONS.md)

## 5. Image provider

**The photo album. It hands back a product's picture as fast as it can: from memory, then from disk, then from the backend.**

- **Files:**
  - `ANSR/Images/ImageProvider.swift` and `HybridImageProvider.swift`
  - `ANSR/Shared/ProductImageLoader.swift`
- **Public API:**
  - `ImageProvider.image(forProductId:)`, the provider's only public function.
  - `ProductImageLoader`, used by view models.
- **How it works:**
  - **Lookup:** memory (about 100 images), then disk (the Caches folder, about 50 MB, oldest removed first, no expiry), then the backend.
    - A downloaded image goes into memory at once.
    - Two requests for the same image share one download.
  - **Persisting:** images are written to disk shortly after download, and anything pending is flushed when the app goes to the background, inside a background task so iOS lets the flush finish. Nothing waits for an exit, because iOS often kills suspended apps without one.
  - **At launch:** saved images are loaded back into memory in the background, without delaying Home.
  - **On screen:** the view model drives each image. The view reports that a tile appeared, and renders a placeholder, the image, or a "failed" icon.
- **Config used:** the cache limits, set in the composition root.
- **Tests:** none of its own. Image behaviour is covered by the manual walkthrough.
- **Rules:**
  - [§7.6](BLUEPRINT.md#76-images-hybridimageprovider)
  - [D-034](../DECISIONS.md) (why it persists on download and background), [D-022](../DECISIONS.md)

## 6. Navigation

**The map. One coordinator knows where the user is, opens each screen, and is the only one that builds screens.**

- **Files:** `ANSR/Navigation/`
  - `AppCoordinator.swift` and `CoordinatorView.swift` (the stack and sheet shell)
  - `Route.swift` and `Sheet.swift`
  - the five navigator protocols, in `Navigating.swift`
- **Public API:**
  - `AppCoordinator.rootView()`.
  - The navigator protocols:
    - `HomeNavigating`
    - `CategoryNavigating`
    - `SearchResultsNavigating`
    - `ProductDetailNavigating`
    - `EnquiryNavigating`
- **How it works:**
  - **The stack:** one `NavigationStack(path:)` rooted at Home, with `Route` values for Category, Search results and Product detail. One sheet holds the enquiry.
  - **Navigators:** each view model gets a small navigator protocol with only the moves it may make, held `weak`. `AppCoordinator` implements them all.
  - **Thin entry points:** every protocol method only forwards to a private `push`, `present`, `dismissPresented` or `pop`.
    - The path can only change inside the coordinator.
    - Back-swipe goes through a binding that calls the private `pop`.
  - **Search:** each search pushes a new results screen, so Back returns to the previous one.
  - **No deep links** yet.
- **Config used:** none.
- **Tests:** `AppCoordinator` tests check that each entry point pushes or presents the right thing, that dismiss and pop work, and that two searches push two screens.
- **Rules:**
  - [§7.4](BLUEPRINT.md#74-coordinator-and-navigation)
  - [D-026](../DECISIONS.md), [D-032](../DECISIONS.md), [D-021](../DECISIONS.md), [D-037](../DECISIONS.md)

## 7. Screens

Each screen is a dumb view and an `@Observable` view model. The view renders view data that's already formatted, and calls intents. The view model loads data through repositories, maps it with pure functions, and navigates through its navigator. Screen table: [§7.8](BLUEPRINT.md#78-screens).

### Home

**The front page: the business's top picks, the categories, and the search bar.**

- **Files:** `ANSR/Features/Home/` (`HomeView`, `HomeViewModel`, `HomeViewData`)
- **How it works:**
  - **Layout:**
    - a large title;
    - a search bar that is always visible;
    - "Top rated": the 5 featured products in a horizontal row;
    - "Categories": rows with chevrons.
  - **Loading:** featured and categories load in parallel. If either fails, the whole screen shows the error with Retry.
  - **Search:** submitting opens Search results with the trimmed text. Search does nothing while the text is blank.
- **Tests:** `HomeViewModel`. It checks the featured tiles in order, category and tile taps, search submit, the blank-search guard, and error then Retry.
- **Rules:**
  - [§7.8.1](BLUEPRINT.md#781-home)
  - [D-035](../DECISIONS.md), [D-036](../DECISIONS.md)

### Category

**One category: its three best products first, then everything else.**

- **Files:** `ANSR/Features/Category/`
- **How it works:**
  - The title is the category name, capitalised.
  - "Top rated" shows the 3 best in a horizontal row. "More in {Category}" shows the rest as a 2-column grid, and is hidden when there's nothing more.
  - A category that no longer exists shows the empty state.
- **Tests:** `CategoryViewModel`. It checks top rated then the rest, the hidden empty section, 404 → empty, and the tile tap.
- **Rules:** [§7.8.2](BLUEPRINT.md#782-category)

### Search results

**Products matching what the user typed.**

- **Files:** `ANSR/Features/SearchResults/`
- **How it works:**
  - The search bar is prefilled with the query. Only the text term is sent.
  - A summary line ("{n} results for '{q}'") sits above a 2-column grid of exactly the returned products.
  - No matches shows an empty state that names the query.
  - Searching again pushes a new results screen.
- **Tests:** `SearchResultsViewModel`. It checks that the term is sent, that only the results are shown, the summary and empty text, and that a new search pushes.
- **Rules:**
  - [§7.8.3](BLUEPRINT.md#783-search-results)
  - [D-037](../DECISIONS.md), [D-008](../DECISIONS.md)

### Product detail

**Everything about one product, and the way to ask about it.**

- **Files:** `ANSR/Features/ProductDetail/`
- **How it works:**
  - The product is fetched by id.
  - The screen shows a large image, the title, price, rating, category and description.
  - Enquire is pinned at the bottom and opens the enquiry sheet.
  - A product that no longer exists shows the empty state.
- **Tests:** `ProductDetailViewModel`. It checks the load by id, the mapping, 404 → empty, and that Enquire opens the sheet.
- **Rules:**
  - [§7.8.4](BLUEPRINT.md#784-product-detail)
  - [D-012](../DECISIONS.md)

### Enquiry sheet

**A short form that emails the sales team and says thank you.**

- **Files:** `ANSR/Features/Enquiry/`
- **How it works:**
  - **Fields:** name, email and message live in the view model.
    - Validation mirrors the backend.
    - Submit stays disabled until the form is valid.
  - **States:** editing → submitting → submitted (thank-you) or failed.
  - **While submitting,** the sheet can't be swiped away.
  - **On failure,** everything typed is kept and Submit works again.
  - **Done** closes the sheet.
- **Tests:** `EnquiryViewModel`. It covers:
  - valid → sent → thank-you;
  - invalid input blocked with no request;
  - failure keeps the input;
  - Done dismisses.
- **Rules:**
  - [§7.8.5](BLUEPRINT.md#785-enquiry-sheet)
  - [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5) (backend rules)
  - [D-038](../DECISIONS.md)

## 8. Shared UI and theme

**The building blocks every screen uses, and the look and feel in one place.**

- **Files:**
  - `ANSR/Shared/`: `ViewState`, `StateContainerView`, `ProductTileView`, `Formatters` and `Strings`
  - `ANSR/Theme/AppTheme.swift`
- **How it works:**
  - **`ViewState`:** loading, loaded, empty or error. There's no idle state, because every screen loads when it appears.
    - `StateContainerView` shows a spinner, a message, or a message with Retry.
    - Loading starts when the screen appears and is cancelled when it's left.
    - Retry shows the spinner again, and a second load while one is running is ignored.
  - **`ProductTileView`:** shows a tile's title, price, rating and image state.
  - **`Formatters`:** pure functions, with the locale passed in. Each turns a value into display text:
    - price with currency;
    - a rating like "4.5 ★ (120)";
    - category names, capitalised.
  - **`Strings`:** all user-facing text, in one file, with no translations.
  - **`AppTheme`:** colour, font, spacing and size tokens, injected once at the root. It uses system colours, so dark mode works.
  - **Accessibility:** out of scope for the proof of concept.
- **Tests:** formatting is checked through the view model tests (price and rating text on tiles and detail).
- **Rules:**
  - [§7.9](BLUEPRINT.md#79-theme-text-and-formatting) (theme, text, formatting)
  - [§7.11](BLUEPRINT.md#711-screen-states-and-shared-ui) (states and shared UI)
  - [D-023](../DECISIONS.md), [D-031](../DECISIONS.md), [D-041](../DECISIONS.md)

---

## Flows per acceptance criterion

Which screen, view model, repository and endpoint each criterion goes through. Navigation always goes view model → navigator → `AppCoordinator`.

| AC | Screen | View model | Repository | Endpoint |
|---|---|---|---|---|
| [AC-1](BLUEPRINT.md#2-acceptance-criteria) Featured | Home | `HomeViewModel` | `ProductRepository.featured()` | `GET /products/featured` |
| [AC-2](BLUEPRINT.md#2-acceptance-criteria) Categories | Home (category rows) → Category | `HomeViewModel` → `CategoryViewModel` | `CategoryRepository.categories()`, then `category(_:)` | `GET /categories`, then `GET /categories/{category}` |
| [AC-3](BLUEPRINT.md#2-acceptance-criteria) Search | Home (search bar) → Search results | `HomeViewModel` → `SearchResultsViewModel` | `ProductRepository.search(_:)` | `GET /products?q=…` |
| [AC-4](BLUEPRINT.md#2-acceptance-criteria) Details | Any tile → Product detail | `ProductDetailViewModel` | `ProductRepository.product(id:)`, plus `ImageProvider` | `GET /products/{id}`, `GET /products/{id}/image` |
| [AC-5](BLUEPRINT.md#2-acceptance-criteria) Enquiry | Product detail → Enquiry sheet | `ProductDetailViewModel` → `EnquiryViewModel` | `EnquiryRepository.submit(_:)` | `POST /enquiries` |

Every tile, on every screen, also loads its image through `ImageProvider` → `GET /products/{id}/image` on a cache miss.

## Testing

The full list is in [BLUEPRINT.md §9.2](BLUEPRINT.md#92-ios-swift-testing), and the AC mapping in [§9.3](BLUEPRINT.md#93-critical-path-traceability).

- **Only requirement-linked tests**, written with Swift Testing:
  - the network client;
  - the five screen view models;
  - the coordinator navigation those flows use.
- **No UI or snapshot tests.**
- **No network:**
  - View models get recording test doubles of their repositories, image provider and navigator.
  - The network client runs against a stub `URLProtocol`.
- **No sleeps:**
  - Tests await view model intents directly.
  - An in-between state, such as submitting, is held open with a continuation.
- **Mutation checks:** each test is seen failing when the behaviour it covers is broken.
- **Manual walkthrough** of AC-1…AC-5 before the PR, on both schemes:
  - **Debug** against the local backend, with the email visible in Mailpit.
  - **Prod** is blocked until a real HTTPS environment exists ([D-040](../DECISIONS.md)).
