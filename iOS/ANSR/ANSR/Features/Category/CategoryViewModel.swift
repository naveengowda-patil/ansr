import Foundation
import Observation

/// The Category screen's state and intents (BLUEPRINT §7.8.2, AC-2). `init` does no work; loading starts from the view's `.task`.
@MainActor @Observable
final class CategoryViewModel {
    private(set) var state: ViewState<CategoryViewData> = .loading
    /// Shown in the navigation bar in every state, from the name the screen was opened with.
    let navigationTitle: String

    @ObservationIgnored private let name: String
    @ObservationIgnored private let categoryRepository: any CategoryRepository
    @ObservationIgnored private let imageLoader: ProductImageLoader
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private weak var navigator: (any CategoryNavigating)?
    @ObservationIgnored private var isLoading = false

    init(
        name: String,
        categoryRepository: any CategoryRepository,
        imageProvider: any ImageProvider,
        navigator: any CategoryNavigating,
        locale: Locale
    ) {
        self.name = name
        self.navigationTitle = Formatters.categoryTitle(name, locale: locale)
        self.categoryRepository = categoryRepository
        self.imageLoader = ProductImageLoader(provider: imageProvider)
        self.navigator = navigator
        self.locale = locale
    }

    // MARK: - Loading

    /// Loads this category. Ignored while a load is running, and once loaded or empty (so coming back doesn't reload).
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
            let data = CategoryViewData.make(from: try await categoryRepository.category(name), locale: locale)
            state = data.isEmpty ? .empty : .loaded(data)
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
}
