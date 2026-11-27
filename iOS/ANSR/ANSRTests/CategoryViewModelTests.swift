import Foundation
import Testing
@testable import ANSR

/// `CategoryViewModel` (BLUEPRINT §9.2, AC-2).
@MainActor
@Suite("CategoryViewModel")
struct CategoryViewModelTests {
    private let repository: StubCategoryRepository
    private let navigator = RecordingCategoryNavigator()
    private let viewModel: CategoryViewModel

    init() {
        self.init(category: .success(Fixtures.jewelery))
    }

    private init(category: Result<CategoryProducts, APIError>) {
        let repository = StubCategoryRepository(category: category)
        self.repository = repository
        self.viewModel = CategoryViewModel(
            name: "jewelery",
            categoryRepository: repository,
            imageProvider: StubImageProvider(),
            navigator: navigator,
            locale: Locale(identifier: "en_US")
        )
    }

    private static func make(category: Result<CategoryProducts, APIError>) -> CategoryViewModelTests {
        CategoryViewModelTests(category: category)
    }

    // MARK: - Loading (AC-2)

    @Test("Loads its own category, then shows top rated first and the rest after, each in API order")
    func loadsTopRatedThenRest() async {
        #expect(viewModel.state == .loading)
        #expect(viewModel.navigationTitle == "Jewelery")

        await viewModel.load()

        #expect(await repository.requestedCategories == ["jewelery"])
        guard case .loaded(let data) = viewModel.state else {
            Issue.record("Expected loaded, got \(viewModel.state)")
            return
        }
        #expect(data.title == "Jewelery")
        #expect(data.topRated.map(\.id) == [5, 7, 8])
        #expect(data.moreTitle == "More in Jewelery")
        #expect(data.rest.map(\.id) == [6])
        #expect(data.topRated.first == ProductTileViewData(id: 5, title: "Bracelet", priceText: "$695.00", ratingText: "4.6 ★ (400)"))
    }

    @Test("No rest means no \"More in\" section")
    func emptyRestHasNoMoreSection() async {
        let onlyTop = CategoryProducts(category: "jewelery", topRated: Fixtures.jewelery.topRated, rest: [])
        let sut = Self.make(category: .success(onlyTop))

        await sut.viewModel.load()

        guard case .loaded(let data) = sut.viewModel.state else {
            Issue.record("Expected loaded, got \(sut.viewModel.state)")
            return
        }
        #expect(data.rest.isEmpty)
    }

    // MARK: - 404, errors and retry

    @Test("404 shows the empty state")
    func notFoundIsEmpty() async {
        let sut = Self.make(category: .failure(.notFound))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .empty)
    }

    @Test("Any other error shows the error state", arguments: [APIError.upstream, .unreachable, .offline, .server(status: 500)])
    func otherErrorsShowError(error: APIError) async {
        let sut = Self.make(category: .failure(error))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .error(message: ErrorMessages.message(for: error)))
    }

    @Test("Retry shows the spinner again, then loads")
    func retryShowsSpinnerThenLoads() async {
        await repository.setCategory(.failure(.upstream))
        await viewModel.load()
        #expect(viewModel.state == .error(message: Strings.errorUpstream))

        await repository.setCategory(.success(Fixtures.jewelery))
        let hold = Hold()
        await repository.holdCategory(hold)
        async let retried: Void = viewModel.retry()
        await hold.untilArrived()
        #expect(viewModel.state == .loading)

        await hold.release()
        await retried
        if case .loaded = viewModel.state {} else { Issue.record("Expected loaded after retry, got \(viewModel.state)") }
    }

    // MARK: - Loading rules

    @Test("A second load while one is running is ignored")
    func secondLoadWhileRunningIsIgnored() async {
        let hold = Hold()
        await repository.holdCategory(hold)

        async let first: Void = viewModel.load()
        await hold.untilArrived()
        // Only the first call is held, so if these weren't ignored they would reach the repository.
        await viewModel.load()
        await viewModel.retry()

        await hold.release()
        await first
        #expect(await repository.requestedCategories.count == 1)
    }

    @Test("Once loaded, coming back (another load) doesn't reload")
    func loadedScreenDoesNotReload() async {
        await viewModel.load()
        await viewModel.load()
        #expect(await repository.requestedCategories.count == 1)
    }

    // MARK: - Intents

    @Test("A tile tap shows that product")
    func tileTapShowsProduct() {
        viewModel.didTapProduct(id: 7)
        #expect(navigator.shownProducts == [7])
    }
}
