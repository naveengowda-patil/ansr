import Foundation

/// Exactly what the Product detail screen shows (BLUEPRINT §7.3, §7.8.4, AC-4).
struct ProductDetailViewData: Equatable, Sendable {
    let id: Int
    let title: String
    let priceText: String
    let ratingText: String
    let categoryText: String
    let description: String
}

extension ProductDetailViewData {
    /// Pure mapping: product + locale in, view data out, with the same formatters as the tiles.
    static func make(from product: Product, locale: Locale) -> ProductDetailViewData {
        ProductDetailViewData(
            id: product.id,
            title: product.title,
            priceText: Formatters.priceText(product.price, currencyCode: product.currency, locale: locale),
            ratingText: Formatters.ratingText(product.rating, locale: locale),
            categoryText: Formatters.categoryTitle(product.category, locale: locale),
            description: product.description
        )
    }
}
