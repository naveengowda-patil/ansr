import Foundation
import Testing
@testable import ANSR

/// `ProductDetailViewModel` (BLUEPRINT §9.2, AC-4).
@MainActor
@Suite("ProductDetailViewModel")
struct ProductDetailViewModelTests {
    private static let jacket = Product(
        id: 3,
        title: "Mens Cotton Jacket",
        description: "Great outerwear jackets for Spring, Autumn and Winter.",
        category: "men's clothing",
        price: Decimal(string: "55.99") ?? 0,
        currency: "USD",
        rating: Rating(rate: 4.7, count: 500)
    )

    private let repository: StubProductRepository
    private let navigator = RecordingProductDetailNavigator()
    private let viewModel: ProductDetailViewModel

    init() {
        self.init(product: .success(Self.jacket))
    }

    private init(product: Result<Product, APIError>) {
        let repository = StubProductRepository(product: product)
        self.repository = repository
        self.viewModel = ProductDetailViewModel(
            productId: 3,
            productRepository: repository,
            imageProvider: StubImageProvider(),
            navigator: navigator,
            locale: Locale(identifier: "en_US")
        )
    }

    private static func make(product: Result<Product, APIError>) -> ProductDetailViewModelTests {
        ProductDetailViewModelTests(product: product)
    }

    // MARK: - Loading (AC-4)

    @Test("Asks the repository for exactly the id it was opened with")
    func loadsItsOwnId() async {
        await viewModel.load()
        #expect(await repository.requestedProductIds == [3])
    }

    @Test("Shows the product's title, description, category, price and rating text")
    func mapsTheProduct() async {
        #expect(viewModel.state == .loading)

        await viewModel.load()

        #expect(viewModel.state == .loaded(ProductDetailViewData(
            id: 3,
            title: "Mens Cotton Jacket",
            priceText: "$55.99",
            ratingText: "4.7 ★ (500)",
            categoryText: "Men's Clothing",
            description: "Great outerwear jackets for Spring, Autumn and Winter."
        )))
    }

    // MARK: - 404, errors and retry

    @Test("404 shows the empty state")
    func notFoundIsEmpty() async {
        let sut = Self.make(product: .failure(.notFound))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .empty)
    }

    @Test("Any other error shows the error state", arguments: [APIError.unreachable, .upstream, .timeout, .decoding])
    func otherErrorsShowError(error: APIError) async {
        let sut = Self.make(product: .failure(error))
        await sut.viewModel.load()
        #expect(sut.viewModel.state == .error(message: ErrorMessages.message(for: error)))
    }

    @Test("Retry shows the spinner again, then loads")
    func retryShowsSpinnerThenLoads() async {
        await repository.setProduct(.failure(.unreachable))
        await viewModel.load()
        #expect(viewModel.state == .error(message: Strings.errorUnreachable))

        await repository.setProduct(.success(Self.jacket))
        let hold = Hold()
        await repository.holdProduct(hold)
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
        await repository.holdProduct(hold)

        async let first: Void = viewModel.load()
        await hold.untilArrived()
        // Only the first call is held, so if these weren't ignored they would reach the repository.
        await viewModel.load()
        await viewModel.retry()

        await hold.release()
        await first
        await viewModel.load()
        #expect(await repository.requestedProductIds.count == 1)
    }

    // MARK: - Enquire

    @Test("Enquire opens the enquiry for the loaded product's id and title")
    func enquireUsesLoadedProduct() async {
        await viewModel.load()
        #expect(viewModel.canEnquire)

        viewModel.didTapEnquire()

        #expect(navigator.enquiries == [.init(productId: 3, productTitle: "Mens Cotton Jacket")])
    }

    @Test("Enquire does nothing before the product has loaded, or when it isn't there")
    func enquireDoesNothingBeforeLoaded() async {
        #expect(!viewModel.canEnquire)
        viewModel.didTapEnquire()

        let missing = Self.make(product: .failure(.notFound))
        await missing.viewModel.load()
        missing.viewModel.didTapEnquire()

        #expect(navigator.enquiries.isEmpty)
        #expect(missing.navigator.enquiries.isEmpty)
    }
}
