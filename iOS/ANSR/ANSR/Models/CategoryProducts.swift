import Foundation

/// `GET /categories/{category}` (BLUEPRINT §6.8, AC-2). `category` is spelled as in the data.
struct CategoryProducts: Decodable, Sendable, Equatable {
    let category: String
    let topRated: [Product]
    let rest: [Product]
}
