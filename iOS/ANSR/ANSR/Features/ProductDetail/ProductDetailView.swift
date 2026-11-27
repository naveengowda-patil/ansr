import SwiftUI

/// The Product detail screen (BLUEPRINT §7.8.4): image, title, price, rating, category and description in a scroll view,
/// with Enquire pinned at the bottom as a full-width button. A dumb view: it renders `ProductDetailViewModel.state` and
/// calls intents.
struct ProductDetailView: View {
    @State private var viewModel: ProductDetailViewModel
    @Environment(\.theme) private var theme

    init(viewModel: ProductDetailViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        StateContainerView(
            state: viewModel.state,
            emptyMessage: Strings.productNotFound,
            retry: { Task { await viewModel.retry() } }
        ) { product in
            ScrollView {
                VStack(alignment: .leading, spacing: theme.spacing.medium) {
                    image
                        .frame(maxWidth: .infinity)
                        .frame(height: theme.imageSizes.detailImageHeight)
                        .background(theme.colors.secondaryBackground)
                        .clipShape(RoundedRectangle(cornerRadius: theme.radii.tile))
                        .task { await viewModel.imageAppeared() }
                    Text(product.title)
                        .font(theme.fonts.title)
                        .foregroundStyle(theme.colors.primaryText)
                    Text(product.priceText)
                        .font(theme.fonts.headline)
                        .foregroundStyle(theme.colors.primaryText)
                    Text(product.ratingText)
                        .font(theme.fonts.subheadline)
                        .foregroundStyle(theme.colors.secondaryText)
                    Text(product.categoryText)
                        .font(theme.fonts.subheadline)
                        .foregroundStyle(theme.colors.secondaryText)
                    Text(product.description)
                        .font(theme.fonts.body)
                        .foregroundStyle(theme.colors.primaryText)
                }
                .padding(theme.spacing.large)
            }
        }
        .background(theme.colors.background)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if viewModel.canEnquire {
                Button(action: viewModel.didTapEnquire) {
                    Text(Strings.productEnquire)
                        .font(theme.fonts.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(theme.spacing.large)
                .background(theme.colors.background)
            }
        }
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private var image: some View {
        switch viewModel.imageState {
        case .loading:
            ProgressView()
        case .loaded(let uiImage):
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .padding(theme.spacing.large)
        case .failed:
            Image(systemName: "photo")
                .font(theme.fonts.title)
                .foregroundStyle(theme.colors.secondaryText)
        }
    }
}

#if DEBUG
#Preview {
    let dependencies = AppDependencies.mock
    let coordinator = AppCoordinator(dependencies: dependencies)
    NavigationStack {
        ProductDetailView(viewModel: ProductDetailViewModel(
            productId: 1,
            productRepository: dependencies.productRepository,
            imageProvider: dependencies.imageProvider,
            navigator: coordinator,
            locale: dependencies.locale
        ))
    }
}
#endif
