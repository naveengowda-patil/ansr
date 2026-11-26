import Foundation
import Testing
@testable import ANSR

/// `SearchResultsViewModel` (BLUEPRINT §9.2, AC-3).
@MainActor
@Suite("SearchResultsViewModel")
struct SearchResultsViewModelTests {
    private let repository: StubProductRepository
    private let navigator = RecordingSearchResultsNavigator()
    private let viewModel: SearchResultsViewModel

    init() {
        self.init(search: .success(Fixtures.ringPage))
    }

    private init(search: Result<ProductPage, APIError>) {
        let repository = StubProductRepository(search: search)
        self.repository = repository
        self.viewModel = SearchResultsViewModel(
            query: "ring",
            productRepository: repository,
            imageProvider: StubImageProvider(),
            navigator: navigator,
            locale: Locale(identifier: "en_US")
        )
    }

    private static func make(search: Result<ProductPage, APIError>) -> SearchResultsViewModelTests {
        SearchResultsViewModelTests(search: search)
    }

    // MARK: - Request and results (AC-3)

    @Test("The repository receives exactly ProductQuery(q: query), nothing else")
    func sendsOnlyTheTerm() async {
        await viewModel.load()
        #expect(await repository.searchQueries == [ProductQuery(q: "ring")])
    }

    @Test("Shows exactly the returned products, in API order, with the plural results line")
    func showsOnlyReturnedProducts() async {
        #expect(viewModel.state == .loading)
        #expect(viewModel.searchText == "ring")

        await viewModel.load()

        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return
        }
        #expect(data.query == "ring")
        #expect(data.summary == "2 results for 'ring'")
        #expect(data.results.map(\.id) == [7, 5])
        #expect(data.results.first == ProductTileViewData(id: 7, title: "Princess Ring", priceText: "$9.99", ratingText: "3.0 ★ (400)"))
    }

    @Test("One result uses the singular line")
    func singularResultsLine() async {
        let one = ProductPage(items: [Fixtures.ringPage.items[0]], total: 1, page: 1, pageSize: 20)
        let sut = Self.make(search: .success(one))

        await sut.viewModel.load()

        guard case .loaded(let data) = sut.viewModel.state else {
            Issue.record("Expected loaded, got \(sut.viewModel.state)")
            return
        }
        #expect(data.summary == "1 result for 'ring'")
    }

    @Test("No results shows the empty state naming the query")
    func noResultsIsEmpty() async {
        let sut = Self.make(search: .success(ProductPage(items: [], total: 0, page: 1, pageSize: 20)))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .empty)
        #expect(sut.viewModel.emptyMessage == "No products match 'ring'.")
    }

    // MARK: - Errors and retry

    @Test("An error shows the error state; Retry shows the spinner again, then loads")
    func errorThenRetry() async {
        await repository.setSearch(.failure(.unreachable))
        await viewModel.load()
        #expect(viewModel.state == .error(message: Strings.errorUnreachable))

        await repository.setSearch(.success(Fixtures.ringPage))
        let hold = Hold()
        await repository.holdSearch(hold)
        async let retried: Void = viewModel.retry()
        await hold.untilArrived()
        #expect(viewModel.state == .loading)

        await hold.release()
        await retried
        if case .loaded = viewModel.state {} else { Issue.record("Expected loaded after retry, got \(viewModel.state)") }
    }

    // MARK: - Loading rules

    @Test("A second load while one is running is ignored, and a loaded screen doesn't reload")
    func secondLoadIsIgnored() async {
        let hold = Hold()
        await repository.holdSearch(hold)

        async let first: Void = viewModel.load()
        await hold.untilArrived()
        // Only the first call is held, so if these weren't ignored they would reach the repository.
        await viewModel.load()
        await viewModel.retry()

        await hold.release()
        await first
        await viewModel.load()
        #expect(await repository.searchQueries.count == 1)
    }

    // MARK: - Searching again

    @Test("A new term pushes results for the trimmed text, and the field goes back to this screen's query")
    func newTermPushes() {
        viewModel.searchText = "  jacket \n"
        #expect(viewModel.canSearch)

        viewModel.didSubmitSearch()

        #expect(navigator.calls == [.searchResults(query: "jacket")])
        #expect(viewModel.searchText == "ring")
    }

    @Test("A blank term, or this screen's own term ignoring case, does nothing", arguments: ["", "   ", "ring", " RING ", "Ring"])
    func blankOrSameTermDoesNothing(text: String) {
        viewModel.searchText = text
        #expect(!viewModel.canSearch)
        viewModel.didSubmitSearch()
        #expect(navigator.calls.isEmpty)
    }

    @Test("Curly quotes are submitted as straight ones, and count as the same term")
    func curlyQuotesAreStraightened() {
        viewModel.searchText = " men\u{2019}s "
        viewModel.didSubmitSearch()
        #expect(navigator.calls == [.searchResults(query: "men's")])

        let sameTerm = SearchResultsViewModel(
            query: "men's",
            productRepository: repository,
            imageProvider: StubImageProvider(),
            navigator: navigator,
            locale: Locale(identifier: "en_US")
        )
        sameTerm.searchText = "Men\u{2019}s"
        #expect(!sameTerm.canSearch)
    }

    @Test("A tile tap shows that product")
    func tileTapShowsProduct() {
        viewModel.didTapProduct(id: 7)
        #expect(navigator.calls == [.product(id: 7)])
    }
}
