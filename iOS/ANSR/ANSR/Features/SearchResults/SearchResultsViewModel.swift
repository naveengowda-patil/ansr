import Foundation
import Observation

/// The Search results screen's state and intents (BLUEPRINT §7.8.3, AC-3). `init` does no work; loading starts from the view's `.task`.
@MainActor @Observable
final class SearchResultsViewModel {
    private(set) var state: ViewState<SearchResultsViewData> = .loading
    /// The search field's text, prefilled with this screen's query.
    var searchText: String
    /// This screen's query, trimmed, as the user submitted it.
    let query: String

    /// False while the trimmed text is empty or is this screen's query (ignoring case), so a submit does nothing.
    var canSearch: Bool {
        let term = trimmedSearchText
        return !term.isEmpty && term.caseInsensitiveCompare(query) != .orderedSame
    }

    /// "No products match '{q}'."
    var emptyMessage: String { Strings.searchEmpty(query: query) }

    @ObservationIgnored private let productRepository: any ProductRepository
    @ObservationIgnored private let imageLoader: ProductImageLoader
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private weak var navigator: (any SearchResultsNavigating)?
    @ObservationIgnored private var isLoading = false

    init(
        query: String,
        productRepository: any ProductRepository,
        imageProvider: any ImageProvider,
        navigator: any SearchResultsNavigating,
        locale: Locale
    ) {
        self.query = query
        self.searchText = query
        self.productRepository = productRepository
        self.imageLoader = ProductImageLoader(provider: imageProvider)
        self.navigator = navigator
        self.locale = locale
    }

    // MARK: - Loading

    /// Searches for the query: text only, the backend's first page. Ignored while a load is running, and once loaded
    /// or empty (so coming back doesn't reload). Any error is the error state. A cancelled load changes nothing.
    func load() async {
        guard !isLoading else { return }
        switch state {
        case .loaded, .empty: return
        case .loading, .error: break
        }
        isLoading = true
        defer { isLoading = false }

        do {
            let page = try await productRepository.search(ProductQuery(q: query))
            state = page.items.isEmpty ? .empty : .loaded(SearchResultsViewData.make(query: query, page: page, locale: locale))
        } catch .cancelled {
            return
        } catch {
            guard !Task.isCancelled else { return }
            state = .error(message: ErrorMessages.message(for: error))
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

    /// Pushes a new results screen for the trimmed text, then puts this screen's field back to its own query,
    /// so Back shows the search that produced these results. Blank text or this screen's own term does nothing.
    func didSubmitSearch() {
        guard canSearch else { return }
        navigator?.showSearchResults(query: trimmedSearchText)
        searchText = query
    }

    private var trimmedSearchText: String {
        SearchTerm.normalized(searchText)
    }
}
