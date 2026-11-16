import ExpoModulesCore
import Foundation
import Security
import Darwin

// Runs through Expo's subscriber before React Native can create MMKV headers.
// The marker belongs to this installation, not to the surviving Keychain.
final class AppleInstallationState {
  static let markerName = "installation-v1"
  private static var startup: Result<String, Error>?
  static func initialize() {
    startup = Result {
      let fm = FileManager.default
      guard let documents = fm.urls(for: .documentDirectory, in: .userDomainMask).first,
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
        throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
      }
      return try prepare(documents: documents, support: support)
    }
  }
  static func currentID() throws -> String {
    guard let startup else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    let expected = try startup.get()
    guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
      try readID(support.appendingPathComponent("MuthoyInstallation").appendingPathComponent(markerName)) == expected else {
      throw databaseKeyError("MU_DBKEY_UNRECOVERABLE")
    }
    return expected
  }
  static func readID(_ file: URL) throws -> String {
    let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true,
      let value = String(data: try Data(contentsOf: file), encoding: .utf8),
      let uuid = UUID(uuidString: value), value == uuid.uuidString.lowercased() else {
      throw databaseKeyError("MU_DBKEY_UNRECOVERABLE")
    }
    return value
  }
  static func exclude(_ directory: URL) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: directory, withIntermediateDirectories: true)
    let original = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard original.isDirectory == true, original.isSymbolicLink != true else {
      throw databaseKeyError("MU_DBKEY_UNRECOVERABLE")
    }
    var target = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try target.setResourceValues(values)
    guard try target.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup == true else {
      throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
    }
  }
  static func prepare(documents: URL, support: URL) throws -> String {
    let fm = FileManager.default
    let directory = support.appendingPathComponent("MuthoyInstallation")
    let marker = directory.appendingPathComponent(markerName)
    let protected = [documents.appendingPathComponent("SQLite"), documents.appendingPathComponent("mmkv")]
    // Missing identity with any old DB/MMKV artifact is NOT a clean install.
    // Never replace a key, delete data or adopt surviving Keychain state here.
    if !fm.fileExists(atPath: marker.path) {
      for path in protected where fm.fileExists(atPath: path.path) {
        guard try fm.contentsOfDirectory(atPath: path.path).isEmpty else {
          throw databaseKeyError("MU_DBKEY_UNRECOVERABLE")
        }
      }
    }
    for path in protected + [directory] { try exclude(path) }
    if fm.fileExists(atPath: marker.path) { return try readID(marker) }
    let value = UUID().uuidString.lowercased()
    let parent = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
    guard parent >= 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    defer { close(parent) }
    // A short write or crash must never publish an invalid authoritative marker.
    // Only this newly-created temporary file may be cleaned up on failure.
    let temporaryName = markerName + "." + UUID().uuidString + ".tmp"
    let fd = openat(parent, temporaryName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
    guard fd >= 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    var promoted = false
    defer {
      close(fd)
      if !promoted { unlinkat(parent, temporaryName, 0) }
    }
    let data = Data(value.utf8)
    let written = data.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
    guard written == data.count, fsync(fd) == 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    if renameatx_np(parent, temporaryName, parent, markerName, UInt32(RENAME_EXCL)) != 0 {
      if errno == EEXIST { return try readID(marker) }
      throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
    }
    promoted = true
    guard fsync(parent) == 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    return try readID(marker)
  }
}

public final class MuthoyDataProtectionSubscriber: ExpoAppDelegateSubscriber {
  public func subscriberDidRegister() { AppleInstallationState.initialize() }
}

// Device-only custody. This key does not survive loss of the phone.
struct AppleDatabaseKeyState: Codable {
  let version: Int
  let current: Data
  let previous: Data?
  let recoveryPending: Bool
  var previousRaw: Data? = nil

  func validated() throws -> AppleDatabaseKeyState {
    guard version == 1, current.count == 32, current.contains(where: { $0 != 0 }),
      previous == nil || (previous!.count == 32 && previous!.contains(where: { $0 != 0 })),
      recoveryPending || (previous == nil && previousRaw == nil) else { throw databaseKeyError("MU_DBKEY_UNRECOVERABLE") }
    return self
  }
}

func databaseKeyError(_ code: String) -> NSError {
  NSError(domain: code, code: 1, userInfo: [NSLocalizedDescriptionKey: code])
}

// One Keychain item makes key/recovery transitions indivisible. Never delete it
// to handle a decode, locked-device, RNG or write failure.
final class AppleDatabaseKeyStore {
  private let service: String
  init(service: String) { self.service = service }
  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
     kSecAttrAccount as String: "database-state-v1", kSecAttrSynchronizable as String: false]
  }
  func rawState() throws -> Data? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let bytes = result as? Data else {
      throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
    }
    return bytes
  }
  func read() throws -> AppleDatabaseKeyState? {
    guard let bytes = try rawState() else { return nil }
    guard let state = try? JSONDecoder().decode(AppleDatabaseKeyState.self, from: bytes) else {
      throw databaseKeyError("MU_DBKEY_UNRECOVERABLE")
    }
    return try state.validated()
  }
  func hasPendingRecovery() throws -> Bool {
    // Keychain access errors still throw. Corrupt bytes are not a pending
    // transition: get/create will raise UNRECOVERABLE and expose authenticated
    // restore, matching Android's independent pending flag startup contract.
    guard let raw = try rawState() else { return false }
    return (try? JSONDecoder().decode(AppleDatabaseKeyState.self, from: raw).validated().recoveryPending) ?? false
  }
  func randomKey() throws -> Data {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess,
      bytes.contains(where: { $0 != 0 }) else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    return Data(bytes)
  }
  func create() throws -> AppleDatabaseKeyState {
    if let existing = try read() { return existing }
    let state = AppleDatabaseKeyState(version: 1, current: try randomKey(), previous: nil, recoveryPending: false)
    return try add(state)
  }
  private func add(_ state: AppleDatabaseKeyState) throws -> AppleDatabaseKeyState {
    _ = try state.validated()
    var q = query
    q[kSecValueData as String] = try JSONEncoder().encode(state)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(q as CFDictionary, nil)
    if status == errSecDuplicateItem, let existing = try read() { return existing }
    guard status == errSecSuccess else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    return state
  }
  private func replace(_ state: AppleDatabaseKeyState) throws {
    _ = try state.validated()
    let value = try JSONEncoder().encode(state)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
    guard status == errSecSuccess else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
  }
  func beginRecovery() throws -> AppleDatabaseKeyState {
    // Called only after the existing server-credential gate. Preserve even
    // undecodable bytes in the same atomic item; locked Keychain still refuses.
    let raw = try rawState()
    let old = raw.flatMap { try? JSONDecoder().decode(AppleDatabaseKeyState.self, from: $0).validated() }
    if let old, old.recoveryPending { return old }
    let state = AppleDatabaseKeyState(version: 1, current: try randomKey(),
      previous: old?.current, recoveryPending: true, previousRaw: raw)
    if raw == nil { return try add(state) }
    try replace(state)
    return state
  }
  func completeRecovery() throws {
    guard let old = try read(), old.recoveryPending else { return }
    try replace(AppleDatabaseKeyState(version: 1, current: old.current, previous: nil, recoveryPending: false))
  }
}

// Restricted to the same five database basenames and SQLite sidecars as Android.
func isMuthoyDatabaseFileName(_ name: String) -> Bool {
  let names = ["muthoy.db", "muthoy.enc.db", "muthoy.restore.db", "muthoy.db.plainbak", "muthoy.db.lockedbak"]
  return names.contains(name) || names.contains(where: { base in
    ["-journal", "-wal", "-shm"].contains(where: { name == base + $0 })
  })
}

func atomicMuthoyDatabaseRename(directory: URL, from: String, to: String) throws {
  guard from != to, isMuthoyDatabaseFileName(from), isMuthoyDatabaseFileName(to) else {
    throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
  }
  let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
  guard fd >= 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
  defer { close(fd) }
  var source = stat()
  guard fstatat(fd, from, &source, AT_SYMLINK_NOFOLLOW) == 0,
    (source.st_mode & S_IFMT) == S_IFREG else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
  // Kernel-enforced no-clobber: an existence check followed by rename is unsafe.
  guard renameatx_np(fd, from, fd, to, UInt32(RENAME_EXCL)) == 0 else {
    throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
  }
  guard fsync(fd) == 0 else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
}

public final class MuthoyDbKeyModule: Module {
  private let queue = DispatchQueue(label: "com.muthoy.database-key")
  private func store() throws -> AppleDatabaseKeyStore {
    guard let bundle = Bundle.main.bundleIdentifier else { throw databaseKeyError("MU_DBKEY_UNAVAILABLE") }
    return AppleDatabaseKeyStore(service: bundle + ".muthoy.db-key.v1." + (try AppleInstallationState.currentID()))
  }
  public func definition() -> ModuleDefinition {
    Name("MuthoyDbKey")
    AsyncFunction("hasDatabaseKeyAsync") { () throws -> Bool in try self.store().rawState() != nil }.runOnQueue(queue)
    AsyncFunction("getOrCreateDatabaseKeyHexAsync") { () throws -> String in
      try self.store().create().current.map { String(format: "%02x", $0) }.joined()
    }.runOnQueue(queue)
    AsyncFunction("hasPendingDatabaseKeyRecoveryAsync") { () throws -> Bool in
      try self.store().hasPendingRecovery()
    }.runOnQueue(queue)
    AsyncFunction("beginDatabaseKeyRecoveryAsync") { () throws -> String in
      try self.store().beginRecovery().current.map { String(format: "%02x", $0) }.joined()
    }.runOnQueue(queue)
    AsyncFunction("completeDatabaseKeyRecoveryAsync") { () throws in try self.store().completeRecovery() }.runOnQueue(queue)
    Function("atomicRenameDatabaseFile") { (from: String, to: String) throws in
      guard let directory = self.appContext?.config.documentDirectory?.appendingPathComponent("SQLite") else {
        throw databaseKeyError("MU_DBKEY_UNAVAILABLE")
      }
      try atomicMuthoyDatabaseRename(directory: directory, from: from, to: to)
    }
  }
}
