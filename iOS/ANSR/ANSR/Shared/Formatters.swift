import Foundation

/// Pure formatting functions (BLUEPRINT §7.9). The `Locale` is always passed in; `Locale.current` is never read here.
enum Formatters {
    /// `$109.95` for `en_US`.
    static func priceText(_ price: Decimal, currencyCode: String, locale: Locale) -> String {
        price.formatted(.currency(code: currencyCode).locale(locale))
    }

    /// `4.5 ★ (120)`, with the rate to one decimal place.
    static func ratingText(_ rating: Rating, locale: Locale) -> String {
        let rate = rating.rate.formatted(.number.precision(.fractionLength(1)).locale(locale))
        let count = rating.count.formatted(.number.locale(locale))
        return Strings.rating(rate: rate, count: count)
    }

    /// `Men's Clothing` for `men's clothing`.
    static func categoryTitle(_ name: String, locale: Locale) -> String {
        name.capitalized(with: locale)
    }
}
