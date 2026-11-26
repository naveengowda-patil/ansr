import UIKit

/// `ImageProvider` that looks in memory, then on disk, then asks the backend (BLUEPRINT §7.6, D-034).
///
/// - Memory: an `NSCache` of about `memoryCountLimit` images.
/// - Disk: one file per product id in `directory`, capped at about `diskByteLimit`, oldest removed first, no expiry.
/// - Network: `Endpoints.productImage(id:)` through `NetworkClient.data(for:)`; one download per id at a time.
/// - Persisting: downloads are written to disk `diskWriteDelay` later, batched, and flushed when the app goes to the background.
/// - At launch, persisted images are loaded into memory in the background, newest first.
///
/// `image(forProductId:)` is its only public function. Disk problems are never fatal: a failed read is a miss, a failed write is dropped.
actor HybridImageProvider: ImageProvider {
    struct Limits: Sendable {
        let memoryCountLimit: Int
        let diskByteLimit: Int
        let diskWriteDelay: Duration
    }

    private let client: any NetworkClient
    private let directory: URL
    private let limits: Limits
    private let notificationCenter: NotificationCenter
    private let memory = NSCache<NSNumber, UIImage>()
    private var inFlight: [Int: Task<UIImage, any Error>] = [:]
    private var pendingWrites: [Int: Data] = [:]
    private var scheduledFlush: Task<Void, Never>?
    private var backgroundFlushes: Task<Void, Never>?

    init(client: any NetworkClient, directory: URL, notificationCenter: NotificationCenter, limits: Limits) {
        self.client = client
        self.directory = directory
        self.limits = limits
        self.notificationCenter = notificationCenter
        memory.countLimit = limits.memoryCountLimit
        Task(priority: .utility) { [weak self] in
            await self?.start()
        }
    }

    deinit {
        backgroundFlushes?.cancel()
    }

    func image(forProductId id: Int) async throws -> UIImage {
        let key = NSNumber(value: id)
        if let cached = memory.object(forKey: key) {
            return cached
        }
        if let running = inFlight[id] {
            return try await running.value
        }
        let task = Task { try await self.loadFromDiskOrNetwork(id) }
        inFlight[id] = task
        defer { inFlight[id] = nil }
        return try await task.value
    }

    // MARK: - Lookup

    private func loadFromDiskOrNetwork(_ id: Int) async throws -> UIImage {
        let key = NSNumber(value: id)
        if let data = await Self.readFile(fileURL(for: id)), let image = await Self.decode(data) {
            memory.setObject(image, forKey: key)
            return image
        }
        let data = try await client.data(for: Endpoints.productImage(id: id))
        guard let image = await Self.decode(data) else { throw ImageProviderError.undecodableImage }
        memory.setObject(image, forKey: key)
        pendingWrites[id] = data
        scheduleFlush()
        return image
    }

    // MARK: - Launch: observe backgrounding, then warm memory from disk

    private func start() async {
        let notifications = notificationCenter.notifications(named: UIApplication.didEnterBackgroundNotification)
        backgroundFlushes = Task.detached { [weak self] in
            for await _ in notifications {
                await self?.flush()
            }
        }
        await warmUp()
    }

    private func warmUp() async {
        let files = await Self.cachedFiles(in: directory)
            .sorted { $0.modified > $1.modified }
            .prefix(limits.memoryCountLimit)
        for file in files {
            guard let id = Int(file.url.lastPathComponent) else { continue }
            let key = NSNumber(value: id)
            if memory.object(forKey: key) == nil,
               let data = await Self.readFile(file.url),
               let image = await Self.decode(data) {
                memory.setObject(image, forKey: key)
            }
            await Task.yield()
        }
    }

    // MARK: - Writing to disk

    private func scheduleFlush() {
        guard scheduledFlush == nil else { return }
        let delay = limits.diskWriteDelay
        scheduledFlush = Task { [weak self] in
            try? await Task.sleep(for: delay)
            await self?.flush()
        }
    }

    private func flush() async {
        scheduledFlush?.cancel()
        scheduledFlush = nil
        guard !pendingWrites.isEmpty else { return }
        let writes = pendingWrites.map { (url: fileURL(for: $0.key), data: $0.value) }
        pendingWrites.removeAll()
        await Self.write(writes, into: directory, byteLimit: limits.diskByteLimit)
    }

    private func fileURL(for id: Int) -> URL {
        directory.appending(path: String(id), directoryHint: .notDirectory)
    }

    // MARK: - File work, off the actor

    private struct CachedFile: Sendable {
        let url: URL
        let modified: Date
        let size: Int
    }

    private nonisolated static func readFile(_ url: URL) async -> Data? {
        try? Data(contentsOf: url)
    }

    private nonisolated static func decode(_ data: Data) async -> UIImage? {
        UIImage(data: data)
    }

    private nonisolated static func cachedFiles(in directory: URL) async -> [CachedFile] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )) ?? []
        return urls.compactMap { url in
            guard let values = try? url.resourceValues(forKeys: keys) else { return nil }
            return CachedFile(url: url, modified: values.contentModificationDate ?? .distantPast, size: values.fileSize ?? 0)
        }
    }

    private nonisolated static func write(_ writes: [(url: URL, data: Data)], into directory: URL, byteLimit: Int) async {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            return
        }
        for write in writes {
            try? write.data.write(to: write.url, options: .atomic)
        }
        await trim(directory, to: byteLimit)
    }

    /// Removes the oldest files (by modification date) until the folder is within `byteLimit`.
    private nonisolated static func trim(_ directory: URL, to byteLimit: Int) async {
        var files = await cachedFiles(in: directory).sorted { $0.modified < $1.modified }
        var total = files.reduce(0) { $0 + $1.size }
        while total > byteLimit, !files.isEmpty {
            let oldest = files.removeFirst()
            if (try? FileManager.default.removeItem(at: oldest.url)) != nil {
                total -= oldest.size
            }
        }
    }
}
