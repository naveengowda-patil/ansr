# Frontend architecture

A reader's guide to the iOS app: what each part does, where it lives, and how the parts fit together.

> **The exact rules live in [`BLUEPRINT.md` §7](BLUEPRINT.md#7-ios-app), the single source of truth.** This guide explains and links to it. It doesn't define rules of its own. If the two ever disagree, the blueprint wins, and the mismatch should be raised.

The app is a SwiftUI iPhone app (iOS 18) built as MVVM-C. Its only data source is our backend: products, categories, images and enquiries all go through it, never to Fake Store directly. File paths below are the files as they are in the repository ([§7.2](BLUEPRINT.md#72-structure)).

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
 8. Shared UI and theme: ViewState, StateContainerView, tiles, the search field, Strings, Formatters, AppTheme
```

The arrows only go one way. A layer talks only to the protocol of the layer below it, and only the composition root (section 1) knows the concrete types. Rules: [§7.3](BLUEPRINT.md#73-mvvm-c-layering-and-models).

---

## 1. Launch and configuration

**The start-up sequence. It reads the build settings once, builds every dependency, and puts Home on screen, or a clear error if the settings are wrong.**

- **Files:**
  - `ANSR/App/AppDelegate.swift`, `SceneDelegate.swift`, `AppBootstrapper.swift`
  - `ANSR/App/AppConfiguration.swift`, `AppDependencies.swift`, `ConfigurationErrorView.swift`
  - `ANSR/Info.plist`
  - `ANSR/Mocks/` (`MockData` and `MockRepositories`, which hold `AppDependencies.mock`, for previews only)
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
  - `Route.swift`, `Sheet.swift` and `Screen.swift` (`Screen` and `SheetScreen`: what a route or the sheet builds, so tests can check it)
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
  - **Thin entry points:** every protocol method only forwards to a private `push`, `present`, `dismissPresented` or `pop(to:)`.
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
    - "Top rated": the 5 featured products in a horizontal row, with no list cell around it;
    - "Categories": rows with chevrons.
    - The list's own background is hidden, so the spinner, the error and the loaded list share the theme's background.
  - **Loading:** featured and categories load in parallel. If either fails, the whole screen shows the error with Retry.
  - **Search:** the shared search field (below). Submitting opens Search results with the trimmed text and clears Home's field. Home ends search mode when it appears again, so its large title comes back.
- **Tests:** `HomeViewModel`. It checks the featured tiles in order, category and tile taps, search submit (trimmed text, field cleared, search mode ended on reappear), the blank-search guard, curly quotes, and error then Retry.
- **Rules:**
  - [§7.8.1](BLUEPRINT.md#781-home)
  - [D-035](../DECISIONS.md), [D-036](../DECISIONS.md)

### Category

**One category: its three best products first, then everything else.**

- **Files:** `ANSR/Features/Category/`
- **How it works:**
  - The title is the category name, capitalised.
  - "Top rated" shows the 3 best in a horizontal row. "More in {Category}" shows the rest as a 2-column grid, and is hidden when there's nothing more.
  - A category that no longer exists shows the empty state. Any other failure shows the error with Retry.
  - Like Home, coming back from a product doesn't reload it.
- **Tests:** `CategoryViewModel`. It checks top rated then the rest, the hidden empty section, 404 → empty, errors and Retry, a second load being ignored, and the tile tap.
- **Rules:** [§7.8.2](BLUEPRINT.md#782-category)

### Search results

**Products matching what the user typed.**

- **Files:** `ANSR/Features/SearchResults/`
- **How it works:**
  - The title and the search field show the query. Only the text term is sent, for page 1 (20 products, which covers the catalogue).
  - A summary line ("{n} results for '{q}'") sits above a 2-column grid of exactly the returned products.
  - No matches shows an empty state that names the query. Any error shows the error with Retry.
  - Searching again pushes a new results screen, so Back returns to the previous results. Searching the same term again does nothing.
  - The field's rules for Cancel, the ✕ and Back are in "The search field" below.
- **Tests:** `SearchResultsViewModel`. It checks that only the term is sent, that only the results are shown, the summary and empty text, errors and Retry, that a new search pushes and ends search mode while a blank or identical one doesn't, that Cancel puts the query back, that the ✕ clears in one tap (also right after a Cancel), and that the query is back in the field when the screen reappears.
- **Rules:**
  - [§7.8.3](BLUEPRINT.md#783-search-results)
  - [D-037](../DECISIONS.md), [D-008](../DECISIONS.md)

### The search field (Home and Search results)

**One search field, shared by the two screens that search, so its rules can't drift apart.**

- **Files:** `ANSR/Shared/ProductSearchField.swift` (`productSearchField(text:isPresented:onSubmit:)`) and `ANSR/Shared/SearchTerm.swift`
- **How it works:**
  - **Always visible** in the navigation bar, with the prompt "Search products", and no auto-capitalisation or autocorrection.
  - **Search runs on the keyboard's Search key**, which is AC-3's "tap search" on iOS ([D-045](../DECISIONS.md)). Nothing is searched while typing. The key is disabled while the field is empty, and whitespace-only text does nothing.
  - **Curly quotes:** the keyboard turns `men's` into `men’s`. `SearchTerm.normalized(_:)` trims the text and straightens the quotes before it's compared or sent.
  - **Search mode belongs to the view model.** The field's `isPresented` is bound to the view model's `isSearchActive`, so a screen you come back to isn't still in search mode, with Cancel showing and its title hidden.
    - Search results ends search mode when a search navigates.
    - Home ends it when it appears again. Ending it while Home was covered left its large title collapsed.
  - **On a results screen the field always shows that screen's query when it isn't being edited:**
    - **Cancel** puts the query back. The system clears the field on Cancel, ends search mode, then clears it once more, so the view model puts back exactly that one extra clear ([D-044](../DECISIONS.md)).
    - **The ✕** clears the field in one tap, in search mode or not.
    - **After a search and Back,** the query is set again when the screen reappears.
  - These rules follow the order in which the system writes to the field, which was logged at runtime rather than guessed. The blueprint lists it.
- **Tests:** in the Home and Search results view model tests, which replay the logged write order.
- **Rules:**
  - [§7.8](BLUEPRINT.md#78-screens) (the field, and what the system does to it)
  - [§7.8.3](BLUEPRINT.md#783-search-results) (Cancel, the ✕ and Back on a results screen)
  - [D-044](../DECISIONS.md), [D-045](../DECISIONS.md), [D-037](../DECISIONS.md)

### Product detail

**Everything about one product, and the way to ask about it.**

- **Files:** `ANSR/Features/ProductDetail/`
- **How it works:**
  - The product is fetched by id.
  - The screen shows a large image, the title, price, rating, category and description.
  - Enquire is a full-width button pinned at the bottom. It stays visible while scrolling, and opens the enquiry sheet once the product has loaded.
  - A product that no longer exists shows the empty state. Any other failure shows the error with Retry.
- **Tests:** `ProductDetailViewModel`. It checks the load by id, the mapping, 404 → empty, errors and Retry, a second load being ignored, and that Enquire opens the sheet only once loaded.
- **Rules:**
  - [§7.8.4](BLUEPRINT.md#784-product-detail)
  - [D-012](../DECISIONS.md)

### Enquiry sheet

**A short form that emails the sales team and says thank you.**

- **Files:** `ANSR/Features/Enquiry/`
- **How it works:**
  - **Fields:** name, email and message live in the view model.
    - Validation mirrors the backend exactly, as pure functions in `EnquiryValidation.swift`: the same limits, the same email pattern, control characters checked before trimming, lengths counted in code points as the backend's zod counts them.
    - Submit stays disabled until the form is valid.
    - A field shows its error only once the user has changed it.
  - **States:** editing → submitting → submitted (thank-you) or failed.
  - **While submitting,** the fields are disabled and the sheet can't be swiped away.
  - **On failure,** the error shows above the form, everything typed is kept and Submit works again. A 404 reads "This product is no longer available."
  - **Cancel** (while editing) and **Done** (after the thank-you) close the sheet.
- **Tests:** `EnquiryViewModel`. It covers:
  - the exact request sent, then the thank-you;
  - each invalid case blocking Submit with no request;
  - failure keeping the input, with the right message, and a resubmit working;
  - a second submit ignored and dismissal blocked while submitting;
  - Done and Cancel dismissing.
- **Rules:**
  - [§7.8.5](BLUEPRINT.md#785-enquiry-sheet)
  - [§6.9](BLUEPRINT.md#69-post-enquiries-ac-5) (backend rules)
  - [D-038](../DECISIONS.md)

## 8. Shared UI and theme

**The building blocks every screen uses, and the look and feel in one place.**

- **Files:**
  - `ANSR/Shared/`:
    - `ViewState` and `StateContainerView`;
    - `ProductTileView`, `ProductTileViewData`, and `ProductTileRow` (which holds both the horizontal row and the 2-column grid);
    - `ProductImageState` and `ProductImageLoader` (section 5);
    - `ErrorMessages` (section 3), `Formatters` and `Strings`;
    - `ProductSearchField` and `SearchTerm` (the search field, in section 7).
  - `ANSR/Theme/AppTheme.swift`
- **How it works:**
  - **`ViewState`:** loading, loaded, empty or error. There's no idle state, because every screen loads when it appears.
    - `StateContainerView` shows a spinner, a message, or a message with Retry.
    - Loading starts when the screen appears and is cancelled when it's left.
    - Retry shows the spinner again, and a second load while one is running is ignored.
  - **`ProductTileView`:** shows a tile's title, price, rating and image state. `ProductTileRow` lays tiles out as a horizontal row (Home and Category "Top rated") and `ProductTileGrid` as a 2-column grid (Category "More in", Search results).
    - **A row sizes its tiles from its own width,** so 2.3 tiles show and the next one peeks on every iPhone, from SE to Pro Max. A row that ended on a whole tile gave no hint that it scrolled. On Category the row runs to the screen edges; on Home it fills the section's width, lined up with the category rows.
  - **`Formatters`:** pure functions, with the locale passed in. Each turns a value into display text:
    - price with currency;
    - a rating like "4.5 ★ (120)";
    - category names, capitalised.
  - **`Strings`:** all user-facing text, in one file, with no translations.
  - **`AppTheme`:** colour, font, spacing and size tokens, injected once at the root. It uses system colours, so dark mode works.
    - The page is the **grouped** background (grey, or black in dark mode) and cards on it are the grouped secondary background (white, or dark grey), so tiles and rows stand out in both modes. With the plain system colours, Home's tiles disappeared into the list cell around them in dark mode.
    - Views never hardcode a colour, font or size; the phase 3.1 layout pass only changed token values and how views use them.
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
