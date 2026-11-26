import Foundation
import Observation

/// Home's state and intents (BLUEPRINT §7.8.1, AC-1). `init` does no work; loading starts from the view's `.task`.
@MainActor @Observable
final class HomeViewModel {
    private(set) var state: ViewState<HomeViewData> = .loading
    /// The search field's text. Bound by the view; submitted trimmed.
    var searchText = ""

    /// False while the trimmed search text is empty, so a submit does nothing.
    var canSearch: Bool { !trimmedSearchText.isEmpty }

    @ObservationIgnored private let productRepository: any ProductRepository
    @ObservationIgnored private let categoryRepository: any CategoryRepository
    @ObservationIgnored private let imageLoader: ProductImageLoader
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private weak var navigator: (any HomeNavigating)?
    @ObservationIgnored private var isLoading = false

    init(
        productRepository: any ProductRepository,
        categoryRepository: any CategoryRepository,
        imageProvider: any ImageProvider,
        navigator: any HomeNavigating,
        locale: Locale
    ) {
        self.productRepository = productRepository
        self.categoryRepository = categoryRepository
        self.imageLoader = ProductImageLoader(provider: imageProvider)
        self.navigator = navigator
        self.locale = locale
    }

    // MARK: - Loading

    /// Loads featured products and categories in parallel. Ignored while a load is running, and once loaded or empty.
    /// If either request fails, the whole screen shows the error. A cancelled load changes nothing.
    func load() async {
        guard !isLoading else { return }
        switch state {
        case .loaded, .empty: return
        case .loading, .error: break
        }
        isLoading = true
        defer { isLoading = false }

        do {
            async let featured = productRepository.featured()
            async let categories = categoryRepository.categories()
            let data = HomeViewData.make(featured: try await featured, categories: try await categories, locale: locale)
            state = data.isEmpty ? .empty : .loaded(data)
        } catch {
            let apiError = (error as? APIError) ?? .transport
            guard apiError != .cancelled, !Task.isCancelled else { return }
            state = .error(message: ErrorMessages.message(for: apiError))
        }
    }

    /// Shows the spinner again, then loads. Ignored while a load is running.
    func retry() async {
        guard !isLoading else { return }
        state = .loading
        await load()
    }

    // MARK: - Images

    func imageState(for id: Int) -> ProductImageState {
        imageLoader.state(for: id)
    }

    func tileAppeared(id: Int) async {
        await imageLoader.load(id: id)
    }

    // MARK: - Intents

    func didTapProduct(id: Int) {
        navigator?.showProduct(id: id)
    }

    func didTapCategory(name: String) {
        navigator?.showCategory(name: name)
    }

    func didSubmitSearch() {
        guard canSearch else { return }
        navigator?.showSearchResults(query: trimmedSearchText)
    }

    private var trimmedSearchText: String {
        SearchTerm.normalized(searchText)
    }
}
