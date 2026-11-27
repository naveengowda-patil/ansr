import Foundation

/// A screen presented as a sheet (BLUEPRINT §7.4).
enum Sheet: Identifiable, Hashable {
    case enquiry(productId: Int, productTitle: String)

    var id: Self { self }
}
