import UIKit

/// Hands back a product's image (BLUEPRINT §7.6).
protocol ImageProvider: Sendable {
    func image(forProductId id: Int) async throws -> UIImage
}

/// Bytes that came back but aren't an image.
enum ImageProviderError: Error, Equatable {
    case undecodableImage
}
