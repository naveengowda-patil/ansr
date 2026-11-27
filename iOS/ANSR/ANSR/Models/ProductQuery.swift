import Foundation

/// The parameters of `GET /products` (BLUEPRINT §6.4). Every field is optional; `Endpoints` sends only the non-empty ones (§7.5).
struct ProductQuery: Sendable, Equatable {
    enum Sort: String, Sendable, Equatable {
        case relevance
        case ratingDescending = "rating_desc"
        case priceAscending = "price_asc"
        case priceDescending = "price_desc"
        case titleAscending = "title_asc"
    }

    var q: String?
    var category: String?
    var minPrice: Decimal?
    var maxPrice: Decimal?
    var minRating: Double?
    var sort: Sort?
    var page: Int?
    var pageSize: Int?

    init(
        q: String? = nil,
        category: String? = nil,
        minPrice: Decimal? = nil,
        maxPrice: Decimal? = nil,
        minRating: Double? = nil,
        sort: Sort? = nil,
        page: Int? = nil,
        pageSize: Int? = nil
    ) {
        self.q = q
        self.category = category
        self.minPrice = minPrice
        self.maxPrice = maxPrice
        self.minRating = minRating
        self.sort = sort
        self.page = page
        self.pageSize = pageSize
    }
}
