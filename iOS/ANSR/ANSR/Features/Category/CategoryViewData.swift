import Foundation

/// Exactly what the Category screen shows (BLUEPRINT §7.3, §7.8.2, AC-2).
struct CategoryViewData: Equatable, Sendable {
    let title: String
    let topRated: [ProductTileViewData]
    let moreTitle: String
    let rest: [ProductTileViewData]

    /// Both lists empty: the screen shows its empty state instead.
    var isEmpty: Bool { topRated.isEmpty && rest.isEmpty }
}

extension CategoryViewData {
    /// Pure mapping: the category's products (API order kept) plus the locale in, view data out.
    static func make(from category: CategoryProducts, locale: Locale) -> CategoryViewData {
        let title = Formatters.categoryTitle(category.category, locale: locale)
        return CategoryViewData(
            title: title,
            topRated: category.topRated.map { ProductTileViewData.make(from: $0, locale: locale) },
            moreTitle: Strings.categoryMore(title),
            rest: category.rest.map { ProductTileViewData.make(from: $0, locale: locale) }
        )
    }
}
