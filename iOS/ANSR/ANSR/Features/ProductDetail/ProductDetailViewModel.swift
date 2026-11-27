import Foundation
import Observation

/// The Product detail screen's state and intents (BLUEPRINT §7.8.4, AC-4). `init` does no work; loading starts from the view's `.task`.
@MainActor @Observable
final class ProductDetailViewModel {
    private(set) var state: ViewState<ProductDetailViewData> = .loading
    let productId: Int

    /// Enquire acts only once the product has loaded.
    var canEnquire: Bool {
        if case .loaded = state { true } else { false }
    }

    @ObservationIgnored private let productRepository: any ProductRepository
    @ObservationIgnored private let imageLoader: ProductImageLoader
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private weak var navigator: (any ProductDetailNavigating)?
    @ObservationIgnored private var isLoading = false

    init(
        productId: Int,
        productRepository: any ProductRepository,
        imageProvider: any ImageProvider,
        navigator: any ProductDetailNavigating,
        locale: Locale
    ) {
        self.productId = productId
        self.productRepository = productRepository
        self.imageLoader = ProductImageLoader(provider: imageProvider)
        self.navigator = navigator
        self.locale = locale
    }

    // MARK: - Loading

    /// Loads the product. Ignored while a load is running, and once loaded or empty (so coming back doesn't reload).
    /// 404 is the empty state; any other failure is the error state. A cancelled load changes nothing.
    func load() async {
        guard !isLoading else { return }
        switch state {
        case .loaded, .empty: return
        case .loading, .error: break
        }
        isLoading = true
        defer { isLoading = false }

        do {
            state = .loaded(ProductDetailViewData.make(from: try await productRepository.product(id: productId), locale: locale))
        } catch .notFound {
            state = .empty
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

    // MARK: - Image

    var imageState: ProductImageState {
        imageLoader.state(for: productId)
    }

    /// Called when the loaded content appears, like a tile.
    func imageAppeared() async {
        await imageLoader.load(id: productId)
    }

    // MARK: - Intents

    /// Opens the enquiry sheet for the loaded product. Does nothing before it has loaded.
    func didTapEnquire() {
        guard case .loaded(let product) = state else { return }
        navigator?.showEnquiry(productId: product.id, productTitle: product.title)
    }
}
