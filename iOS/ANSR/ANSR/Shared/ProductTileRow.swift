import SwiftUI

/// A horizontal row of product tiles (BLUEPRINT §7.8.1 "Top rated", §7.8.2 "Top rated", §7.11). A dumb view: the screen
/// passes the tiles, how to read each image state, and the intents.
///
/// Tiles are sized from the row's width so `rowVisibleTiles` of them show and the next one peeks, on every iPhone.
/// `edgeMargin` insets the first and last tile while the row itself scrolls to its edges (Category runs it full width).
struct ProductTileRow: View {
    let tiles: [ProductTileViewData]
    var edgeMargin: CGFloat = 0
    let imageState: (Int) -> ProductImageState
    let tileAppeared: (Int) async -> Void
    let tileTapped: (Int) -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(spacing: theme.spacing.medium) {
                ForEach(tiles) { tile in
                    ProductTileButton(tile: tile, imageState: imageState, tileAppeared: tileAppeared, tileTapped: tileTapped)
                        .containerRelativeFrame(.horizontal) { width, _ in tileWidth(in: width) }
                }
            }
            .padding(.vertical, theme.spacing.small)
        }
        .contentMargins(.horizontal, edgeMargin, for: .scrollContent)
    }

    /// The width that fits `rowVisibleTiles` tiles, with the gaps between the whole ones, into the visible row.
    private func tileWidth(in width: CGFloat) -> CGFloat {
        let visible = theme.imageSizes.rowVisibleTiles
        let gaps = visible.rounded(.down) * theme.spacing.medium
        return max(0, (width - gaps) / visible)
    }
}

/// A 2-column grid of product tiles (BLUEPRINT §7.8.2 "More in", §7.8.3 results). A dumb view, like `ProductTileRow`.
struct ProductTileGrid: View {
    let tiles: [ProductTileViewData]
    let imageState: (Int) -> ProductImageState
    let tileAppeared: (Int) async -> Void
    let tileTapped: (Int) -> Void

    @Environment(\.theme) private var theme

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.flexible(), spacing: theme.spacing.medium), GridItem(.flexible(), spacing: theme.spacing.medium)],
            spacing: theme.spacing.medium
        ) {
            ForEach(tiles) { tile in
                ProductTileButton(tile: tile, imageState: imageState, tileAppeared: tileAppeared, tileTapped: tileTapped)
            }
        }
    }
}

/// One tappable tile, shared by the row and the grid.
private struct ProductTileButton: View {
    let tile: ProductTileViewData
    let imageState: (Int) -> ProductImageState
    let tileAppeared: (Int) async -> Void
    let tileTapped: (Int) -> Void

    var body: some View {
        Button {
            tileTapped(tile.id)
        } label: {
            ProductTileView(data: tile, imageState: imageState(tile.id), onAppear: { await tileAppeared(tile.id) })
        }
        .buttonStyle(.plain)
    }
}
