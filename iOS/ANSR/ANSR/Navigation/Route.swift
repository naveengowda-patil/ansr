import Foundation

/// A screen pushed onto the navigation stack (BLUEPRINT §7.4). Home is the root and has no route.
enum Route: Hashable {
    case category(name: String)
    case product(id: Int)
    case searchResults(query: String)
}
