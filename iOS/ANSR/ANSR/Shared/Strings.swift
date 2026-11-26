import Foundation

/// All user-facing text (BLUEPRINT §7.9). English only; text with values in it is built by functions here.
enum Strings {
    // MARK: Common
    static let retry = "Retry"
    static let searchPrompt = "Search products"

    // MARK: Errors (§7.5)
    static let errorOffline = "You're offline. Check your connection and try again."
    static let errorTimeout = "The server took too long to respond. Please try again."
    static let errorUpstream = "We can't reach the catalogue right now. Please try again in a moment."
    static let errorValidation = "Please check your details and try again."
    static let errorNotFound = "This item is no longer available."
    static let errorGeneric = "Something went wrong. Please try again."

    // MARK: Configuration error (§7.7)
    static let configurationErrorTitle = "The app isn't set up correctly"
    static func configurationErrorDetail(key: String) -> String {
        "The build setting \(key) is missing or invalid. Check the scheme's configuration and rebuild."
    }

    // MARK: Home (§7.8.1)
    static let homeTitle = "Catalogue"
    static let homeTopRated = "Top rated"
    static let homeCategories = "Categories"
    static let homeEmpty = "No products to show right now."
    /// Shown until the real Home screen lands (phase 2).
    static let homePlaceholder = "Products are on their way."

    // MARK: Category (§7.8.2)
    static let categoryTopRated = "Top rated"
    static func categoryMore(_ categoryTitle: String) -> String { "More in \(categoryTitle)" }
    static let categoryNotFound = "This category is no longer available."

    // MARK: Search results (§7.8.3)
    static func searchSummary(count: Int, query: String) -> String {
        count == 1 ? "1 result for '\(query)'" : "\(count) results for '\(query)'"
    }
    static func searchEmpty(query: String) -> String { "No products match '\(query)'." }

    // MARK: Product detail (§7.8.4)
    static let productEnquire = "Enquire"
    static let productNotFound = "This product is no longer available."

    // MARK: Enquiry (§7.8.5)
    static let enquiryName = "Name"
    static let enquiryEmail = "Email"
    static let enquiryMessage = "Message (optional)"
    static let enquirySubmit = "Submit"
    static let enquiryDone = "Done"
    static func enquiryThanks(name: String, email: String) -> String {
        "Thank you, \(name). Our sales team will reply to \(email) soon."
    }

    // MARK: Formatting (§7.9)
    /// `4.5 ★ (120)`, from already-formatted numbers.
    static func rating(rate: String, count: String) -> String { "\(rate) ★ (\(count))" }
}
