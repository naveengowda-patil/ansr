import SwiftUI

/// One product tile (BLUEPRINT §7.11): image state, title, price and rating. It reports its appearance with `.task`,
/// so the view model can load the image (§7.6) and the request is cancelled if the tile goes away first.
struct ProductTileView: View {
    let data: ProductTileViewData
    let imageState: ProductImageState
    let onAppear: () async -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: theme.spacing.small) {
            image
                .frame(maxWidth: .infinity)
                .frame(height: theme.imageSizes.tileImageHeight)
                .background(theme.colors.placeholder)
                .clipShape(RoundedRectangle(cornerRadius: theme.radii.image))
            Text(data.title)
                .font(theme.fonts.subheadline)
                .foregroundStyle(theme.colors.primaryText)
                .lineLimit(2, reservesSpace: true)
            Text(data.priceText)
                .font(theme.fonts.headline)
                .foregroundStyle(theme.colors.primaryText)
            Text(data.ratingText)
                .font(theme.fonts.caption)
                .foregroundStyle(theme.colors.secondaryText)
        }
        .padding(theme.spacing.small)
        .background(theme.colors.secondaryBackground)
        .clipShape(RoundedRectangle(cornerRadius: theme.radii.tile))
        .task { await onAppear() }
    }

    @ViewBuilder
    private var image: some View {
        switch imageState {
        case .loading:
            ProgressView()
        case .loaded(let uiImage):
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .padding(theme.spacing.small)
        case .failed:
            Image(systemName: "photo")
                .font(theme.fonts.title)
                .foregroundStyle(theme.colors.secondaryText)
        }
    }
}

#if DEBUG
#Preview {
    ProductTileView(
        data: ProductTileViewData(id: 1, title: "Fjallraven - Foldsack No. 1 Backpack", priceText: "$109.95", ratingText: "3.9 ★ (120)"),
        imageState: .failed,
        onAppear: {}
    )
    .frame(width: AppTheme.standard.imageSizes.tileWidth)
}
#endif
