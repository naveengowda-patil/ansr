import UIKit

/// The state of one product image on screen (BLUEPRINT §7.6): a placeholder, the image, or a "failed" icon.
enum ProductImageState: Equatable {
    case loading
    case loaded(UIImage)
    case failed
}
