import Foundation

/// What a product tile renders, already formatted (BLUEPRINT §7.3). Shared by every screen that shows tiles.
struct ProductTileViewData: Equatable, Identifiable, Sendable {
    let id: Int
    let title: String
    let priceText: String
    let ratingText: String
}

extension ProductTileViewData {
    /// Pure mapping: product + locale in, tile out.
    static func make(from product: Product, locale: Locale) -> ProductTileViewData {
        ProductTileViewData(
            id: product.id,
            title: product.title,
            priceText: Formatters.priceText(product.price, currencyCode: product.currency, locale: locale),
            ratingText: Formatters.ratingText(product.rating, locale: locale)
        )
    }
}
