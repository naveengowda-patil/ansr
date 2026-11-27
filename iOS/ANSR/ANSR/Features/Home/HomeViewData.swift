import Foundation

/// Exactly what Home shows (BLUEPRINT §7.3, §7.8.1).
struct HomeViewData: Equatable, Sendable {
    let featured: [ProductTileViewData]
    let categories: [CategoryRowViewData]

    /// Both lists empty: Home shows its empty state instead.
    var isEmpty: Bool { featured.isEmpty && categories.isEmpty }
}

/// One category row: `title` for display, `name` as the data spells it, for navigation.
struct CategoryRowViewData: Equatable, Identifiable, Sendable {
    let name: String
    let title: String

    var id: String { name }
}

extension HomeViewData {
    /// Pure mapping: featured products and category names in API order, plus the locale, in; view data out.
    static func make(featured: [Product], categories: [String], locale: Locale) -> HomeViewData {
        HomeViewData(
            featured: featured.map { ProductTileViewData.make(from: $0, locale: locale) },
            categories: categories.map { CategoryRowViewData(name: $0, title: Formatters.categoryTitle($0, locale: locale)) }
        )
    }
}
