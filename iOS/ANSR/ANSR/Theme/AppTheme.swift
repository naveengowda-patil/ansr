import SwiftUI

/// Every colour, font, spacing value, corner radius and image size the views use (BLUEPRINT §7.9, D-023).
/// Colours are system semantic colours, so dark mode works. Injected once at the root through `\.theme`.
struct AppTheme: Sendable {
    struct Colors: Sendable {
        let background: Color
        let secondaryBackground: Color
        let primaryText: Color
        let secondaryText: Color
        let accent: Color
        let placeholder: Color
        let error: Color
    }

    struct Fonts: Sendable {
        let title: Font
        let headline: Font
        let body: Font
        let subheadline: Font
        let caption: Font
    }

    struct Spacing: Sendable {
        let extraSmall: CGFloat
        let small: CGFloat
        let medium: CGFloat
        let large: CGFloat
        let extraLarge: CGFloat
    }

    struct Radii: Sendable {
        let tile: CGFloat
        let image: CGFloat
    }

    struct ImageSizes: Sendable {
        let tileWidth: CGFloat
        let tileImageHeight: CGFloat
        let detailImageHeight: CGFloat
    }

    let colors: Colors
    let fonts: Fonts
    let spacing: Spacing
    let radii: Radii
    let imageSizes: ImageSizes
}

extension AppTheme {
    /// The app's one theme. Created by the composition root (`AppDependencies.live`) and used as the environment default.
    static let standard = AppTheme(
        colors: Colors(
            background: Color(uiColor: .systemBackground),
            secondaryBackground: Color(uiColor: .secondarySystemBackground),
            primaryText: Color(uiColor: .label),
            secondaryText: Color(uiColor: .secondaryLabel),
            accent: .accentColor,
            placeholder: Color(uiColor: .tertiarySystemFill),
            error: Color(uiColor: .systemRed)
        ),
        fonts: Fonts(
            title: .title2.weight(.semibold),
            headline: .headline,
            body: .body,
            subheadline: .subheadline,
            caption: .caption
        ),
        spacing: Spacing(extraSmall: 4, small: 8, medium: 12, large: 16, extraLarge: 24),
        radii: Radii(tile: 12, image: 8),
        imageSizes: ImageSizes(tileWidth: 150, tileImageHeight: 120, detailImageHeight: 280)
    )
}

extension EnvironmentValues {
    /// The app theme. Views read tokens from here and never hardcode colours, fonts or spacing.
    @Entry var theme: AppTheme = .standard
}
