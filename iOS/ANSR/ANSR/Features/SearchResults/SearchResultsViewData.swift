import Foundation

/// Exactly what the Search results screen shows (BLUEPRINT §7.3, §7.8.3, AC-3).
struct SearchResultsViewData: Equatable, Sendable {
    let query: String
    /// "6 results for 'ring'", or "1 result for 'ring'".
    let summary: String
    let results: [ProductTileViewData]
}

extension SearchResultsViewData {
    /// Pure mapping: the query, the page (API order kept) and the locale in, view data out. The count is the page's `total`.
    static func make(query: String, page: ProductPage, locale: Locale) -> SearchResultsViewData {
        SearchResultsViewData(
            query: query,
            summary: Strings.searchSummary(count: page.total, query: query),
            results: page.items.map { ProductTileViewData.make(from: $0, locale: locale) }
        )
    }
}
