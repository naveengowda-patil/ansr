import Foundation
import Testing
@testable import ANSR

/// `HomeViewModel` (BLUEPRINT §9.2, AC-1 plus the AC-2 and AC-3 entry points).
@MainActor
@Suite("HomeViewModel")
struct HomeViewModelTests {
    private let products: StubProductRepository
    private let categories: StubCategoryRepository
    private let navigator = RecordingHomeNavigator()
    private let viewModel: HomeViewModel

    init() {
        self.init(featured: .success(Fixtures.featured), categories: .success(Fixtures.categories))
    }

    private init(featured: Result<[Product], APIError>, categories: Result<[String], APIError>) {
        let products = StubProductRepository(featured: featured)
        let categories = StubCategoryRepository(categories: categories)
        self.products = products
        self.categories = categories
        self.viewModel = HomeViewModel(
            productRepository: products,
            categoryRepository: categories,
            imageProvider: StubImageProvider(),
            navigator: navigator,
            locale: Locale(identifier: "en_US")
        )
    }

    private static func make(featured: Result<[Product], APIError>, categories: Result<[String], APIError>) -> HomeViewModelTests {
        HomeViewModelTests(featured: featured, categories: categories)
    }

    // MARK: - Loading (AC-1)

    @Test("Starts loading, then shows the 5 featured products as tiles in API order, with formatted price and rating")
    func loadsFeaturedTiles() async throws {
        #expect(viewModel.state == .loading)

        await viewModel.load()

        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return
        }
        #expect(data.featured.map(\.id) == [1, 5, 9, 13, 17])
        #expect(data.featured.first == ProductTileViewData(id: 1, title: "Backpack", priceText: "$109.95", ratingText: "3.9 ★ (120)"))
        #expect(data.featured[1].priceText == "$695.00")
    }

    @Test("Categories are capitalised for display and keep the data's spelling for navigation")
    func mapsCategories() async {
        await viewModel.load()

        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return
        }
        #expect(data.categories == [
            CategoryRowViewData(name: "men's clothing", title: "Men's Clothing"),
            CategoryRowViewData(name: "jewelery", title: "Jewelery"),
            CategoryRowViewData(name: "electronics", title: "Electronics"),
            CategoryRowViewData(name: "women's clothing", title: "Women's Clothing"),
        ])
    }

    // MARK: - Errors and retry

    @Test("Either request failing shows the full-screen error", arguments: [
        (Result<[Product], APIError>.failure(.upstream), Result<[String], APIError>.success(Fixtures.categories)),
        (Result<[Product], APIError>.success(Fixtures.featured), Result<[String], APIError>.failure(.offline)),
    ])
    func eitherFailureShowsError(featured: Result<[Product], APIError>, categories: Result<[String], APIError>) async {
        let sut = Self.make(featured: featured, categories: categories)

        await sut.viewModel.load()

        guard case .error(let message) = sut.viewModel.state else {
            Issue.record("Expected error, got \(sut.viewModel.state)")
            return
        }
        #expect(!message.isEmpty)
    }

    @Test("Retry shows the spinner again, then loads")
    func retryShowsSpinnerThenLoads() async {
        await products.setFeatured(.failure(.upstream))
        await viewModel.load()
        #expect(viewModel.state == .error(message: Strings.errorUpstream))

        await products.setFeatured(.success(Fixtures.featured))
        let hold = Hold()
        await products.holdFeatured(hold)
        async let retried: Void = viewModel.retry()
        await hold.untilArrived()
        #expect(viewModel.state == .loading)

        await hold.release()
        await retried
        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected loaded after retry, got \(viewModel.state)")
            return
        }
        #expect(data.featured.count == 5)
    }

    @Test("A cancelled load leaves the screen loading, so it runs again on the next appearance")
    func cancelledLoadChangesNothing() async {
        let sut = Self.make(featured: .failure(.cancelled), categories: .success(Fixtures.categories))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .loading)
    }

    // MARK: - Empty rules

    @Test("One empty list hides only its section", arguments: [
        ([Product](), Fixtures.categories),
        (Fixtures.featured, [String]()),
    ])
    func oneEmptyListStillLoads(featured: [Product], categories: [String]) async {
        let sut = Self.make(featured: .success(featured), categories: .success(categories))

        await sut.viewModel.load()

        guard case .loaded(let data) = sut.viewModel.state else {
            Issue.record("Expected loaded, got \(sut.viewModel.state)")
            return
        }
        #expect(data.featured.count == featured.count)
        #expect(data.categories.count == categories.count)
    }

    @Test("Both lists empty shows the empty state")
    func bothEmptyIsEmpty() async {
        let sut = Self.make(featured: .success([]), categories: .success([]))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .empty)
    }

    // MARK: - Loading rules

    @Test("A second load while one is running is ignored")
    func secondLoadWhileRunningIsIgnored() async {
        let hold = Hold()
        await products.holdFeatured(hold)

        async let first: Void = viewModel.load()
        await hold.untilArrived()
        // The first load is held inside featured(). Only that one call is held, so if these weren't ignored
        // they would reach the repository and the call counts below would fail (rather than hang).
        await viewModel.load()
        await viewModel.retry()

        await hold.release()
        await first
        #expect(await products.featuredCallCount == 1)
        #expect(await categories.categoriesCallCount == 1)
        if case .loaded = viewModel.state {} else { Issue.record("Expected loaded, got \(viewModel.state)") }
    }

    @Test("Once loaded, another load (e.g. coming back to Home) doesn't reload")
    func loadedScreenDoesNotReload() async {
        await viewModel.load()
        await viewModel.load()
        #expect(await products.featuredCallCount == 1)
    }

    // MARK: - Intents (AC-1, AC-2 and AC-3 entry points)

    @Test("A tile tap shows that product")
    func tileTapShowsProduct() {
        viewModel.didTapProduct(id: 5)
        #expect(navigator.calls == [.product(id: 5)])
    }

    @Test("A category tap shows the category with the data's spelling")
    func categoryTapShowsCategory() {
        viewModel.didTapCategory(name: "men's clothing")
        #expect(navigator.calls == [.category(name: "men's clothing")])
    }

    @Test("A search submit shows results for the trimmed term and clears the field; coming back ends search mode")
    func searchSubmitIsTrimmed() {
        viewModel.isSearchActive = true
        viewModel.searchText = "  ring \n"
        #expect(viewModel.canSearch)
        viewModel.didSubmitSearch()
        #expect(navigator.calls == [.searchResults(query: "ring")])
        #expect(viewModel.searchText.isEmpty)

        viewModel.screenAppeared()
        #expect(!viewModel.isSearchActive)
    }

    @Test("Curly quotes from the keyboard are submitted as straight ones")
    func curlyQuotesAreStraightened() {
        viewModel.searchText = "men\u{2019}s \u{201C}slim\u{201D}"
        viewModel.didSubmitSearch()
        #expect(navigator.calls == [.searchResults(query: "men's \"slim\"")])
    }

    @Test("A blank search does nothing", arguments: ["", "   ", "\n\t "])
    func blankSearchDoesNothing(text: String) {
        viewModel.isSearchActive = true
        viewModel.searchText = text
        #expect(!viewModel.canSearch)
        viewModel.didSubmitSearch()
        #expect(navigator.calls.isEmpty)
        #expect(viewModel.isSearchActive)
    }

    @Test("Ending search mode without a submit leaves the field as typed: Home has no query to restore")
    func endingSearchModeLeavesField() {
        viewModel.isSearchActive = true
        viewModel.searchText = "rin"
        viewModel.isSearchActive = false
        #expect(viewModel.searchText == "rin")
        #expect(navigator.calls.isEmpty)
    }
}
