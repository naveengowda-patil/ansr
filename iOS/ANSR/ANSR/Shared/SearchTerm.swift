import Foundation

/// The one rule for turning what the user typed into a search term (BLUEPRINT §7.8).
enum SearchTerm {
    /// Trims whitespace and turns typographic quotes into straight ones. The keyboard's smart punctuation types `men’s`
    /// for `men's`, and the catalogue uses straight apostrophes, so without this the search would match nothing.
    static func normalized(_ text: String) -> String {
        var term = text.trimmingCharacters(in: .whitespacesAndNewlines)
        for (curly, straight) in replacements {
            term = term.replacingOccurrences(of: curly, with: straight)
        }
        return term
    }

    private static let replacements: [(String, String)] = [
        ("\u{2018}", "'"), ("\u{2019}", "'"), ("\u{201B}", "'"),
        ("\u{201C}", "\""), ("\u{201D}", "\""), ("\u{201E}", "\""),
    ]
}
