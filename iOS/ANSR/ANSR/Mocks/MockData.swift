#if DEBUG
import Foundation

/// Sample products for previews (BLUEPRINT §7.7, D-014). Debug builds only.
enum MockData {
    static let products: [Product] = [
        Product(id: 1, title: "Fjallraven - Foldsack No. 1 Backpack", description: "Your perfect pack for everyday use.",
                category: "men's clothing", price: Decimal(string: "109.95") ?? 0, currency: "USD", rating: Rating(rate: 3.9, count: 120)),
        Product(id: 5, title: "John Hardy Women's Legends Naga Bracelet", description: "From our Legends Collection.",
                category: "jewelery", price: 695, currency: "USD", rating: Rating(rate: 4.6, count: 400)),
        Product(id: 9, title: "WD 2TB Elements Portable External Hard Drive", description: "USB 3.0 and USB 2.0 compatibility.",
                category: "electronics", price: 64, currency: "USD", rating: Rating(rate: 3.3, count: 203)),
    ]

    static let categories = ["electronics", "jewelery", "men's clothing", "women's clothing"]
}
#endif
