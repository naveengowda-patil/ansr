import UIKit

/// Loads product images for one screen and keeps one `ProductImageState` per product id (BLUEPRINT §7.6, D-022).
/// Owned by a view model; each id is requested once per screen.
@MainActor @Observable
final class ProductImageLoader {
    private(set) var states: [Int: ProductImageState] = [:]

    @ObservationIgnored private let provider: any ImageProvider

    init(provider: any ImageProvider) {
        self.provider = provider
    }

    /// A placeholder until the image has loaded or failed.
    func state(for id: Int) -> ProductImageState {
        states[id] ?? .loading
    }

    /// Requests the image once. A request cancelled because its tile went away is forgotten, so the next appearance asks again.
    func load(id: Int) async {
        guard states[id] == nil else { return }
        states[id] = .loading
        do {
            states[id] = .loaded(try await provider.image(forProductId: id))
        } catch {
            if Task.isCancelled || error is CancellationError || (error as? APIError) == .cancelled {
                states[id] = nil
            } else {
                states[id] = .failed
            }
        }
    }
}
