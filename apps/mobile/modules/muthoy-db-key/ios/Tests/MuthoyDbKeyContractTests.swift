// Native XCTest sources only. NOT RUN on the Windows implementation host.
import XCTest
import Security
@testable import MuthoyDbKey

final class MuthoyDbKeyContractTests: XCTestCase {
  func testKeychainLifecycleAndPreservedRecoveryKey() throws {
    let service = "com.muthoy.synthetic-tests." + UUID().uuidString
    defer { SecItemDelete([kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service] as CFDictionary) }
    let store = AppleDatabaseKeyStore(service: service)
    XCTAssertNil(try store.read())
    let original = try store.create()
    XCTAssertEqual(original.current.count, 32)
    XCTAssertEqual(try store.create().current, original.current)
    let recovering = try store.beginRecovery()
    XCTAssertNotEqual(recovering.current, original.current)
    XCTAssertEqual(recovering.previous, original.current)
    XCTAssertTrue(recovering.recoveryPending)
    XCTAssertEqual(try store.beginRecovery().current, recovering.current)
    try store.completeRecovery()
    XCTAssertEqual(try store.read()?.current, recovering.current)
    XCTAssertNil(try store.read()?.previous)
    XCTAssertFalse(try XCTUnwrap(store.read()).recoveryPending)
  }
  func testMalformedKeychainStateNeverMintsAReplacement() throws {
    let service = "com.muthoy.synthetic-tests." + UUID().uuidString
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "database-state-v1"]
    defer { SecItemDelete(query as CFDictionary) }
    let store = AppleDatabaseKeyStore(service: service)
    _ = try store.create()
    XCTAssertEqual(SecItemUpdate(query as CFDictionary,
      [kSecValueData as String: Data("invalid-state".utf8)] as CFDictionary), errSecSuccess)
    XCTAssertFalse(try store.hasPendingRecovery())
    XCTAssertThrowsError(try store.create())
    XCTAssertThrowsError(try store.read())
    let state = try store.beginRecovery()
    XCTAssertEqual(state.previousRaw, Data("invalid-state".utf8))
    XCTAssertNil(state.previous)
    XCTAssertTrue(state.recoveryPending)
    XCTAssertEqual(try store.beginRecovery().current, state.current)
    XCTAssertEqual(try store.read()?.previousRaw, Data("invalid-state".utf8))
    try store.completeRecovery()
    XCTAssertNil(try store.read()?.previousRaw)
  }
  func testMissingKeyRecoveryAddsOnlyPendingState() throws {
    let service = "com.muthoy.synthetic-tests." + UUID().uuidString
    defer { SecItemDelete([kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service] as CFDictionary) }
    let store = AppleDatabaseKeyStore(service: service)
    let state = try store.beginRecovery()
    XCTAssertTrue(state.recoveryPending)
    XCTAssertNil(state.previous)
    XCTAssertNil(state.previousRaw)
    XCTAssertEqual(try store.read()?.current, state.current)
  }
  func testInstallationIdentityBackupExclusionsAndFailClosedArtifacts() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let documents = root.appendingPathComponent("Documents")
    let support = root.appendingPathComponent("Library/Application Support")
    try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) } // this synthetic directory only
    let id = try AppleInstallationState.prepare(documents: documents, support: support)
    XCTAssertEqual(try AppleInstallationState.prepare(documents: documents, support: support), id)
    for path in [documents.appendingPathComponent("SQLite"), documents.appendingPathComponent("mmkv"), support.appendingPathComponent("MuthoyInstallation")] {
      XCTAssertEqual(try path.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }
    let marker = support.appendingPathComponent("MuthoyInstallation/installation-v1")
    try Data("corrupt".utf8).write(to: marker)
    XCTAssertThrowsError(try AppleInstallationState.prepare(documents: documents, support: support))
    XCTAssertEqual(try Data(contentsOf: marker), Data("corrupt".utf8))
    try FileManager.default.removeItem(at: marker) // synthetic lost-marker control
    try Data("existing-ciphertext".utf8).write(to: documents.appendingPathComponent("SQLite/muthoy.db"))
    XCTAssertThrowsError(try AppleInstallationState.prepare(documents: documents, support: support))
    XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    let freshDocuments = root.appendingPathComponent("Fresh/Documents")
    try FileManager.default.createDirectory(at: freshDocuments, withIntermediateDirectories: true)
    let fresh = try AppleInstallationState.prepare(documents: freshDocuments, support: root.appendingPathComponent("Fresh/Support"))
    XCTAssertNotEqual(fresh, id)
  }
  func testUnpublishedPartialTemporaryMarkerAllowsFreshRetry() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let documents = root.appendingPathComponent("Documents")
    let support = root.appendingPathComponent("Support")
    let metadata = support.appendingPathComponent("MuthoyInstallation")
    try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: metadata, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) } // synthetic only
    let abandoned = metadata.appendingPathComponent("installation-v1.synthetic.tmp")
    try Data("partial".utf8).write(to: abandoned)
    let id = try AppleInstallationState.prepare(documents: documents, support: support)
    XCTAssertNotNil(UUID(uuidString: id))
    XCTAssertEqual(try AppleInstallationState.readID(metadata.appendingPathComponent("installation-v1")), id)
    XCTAssertEqual(try Data(contentsOf: abandoned), Data("partial".utf8))
  }
  func testRenameIsNoClobberAndRejectsTraversalAndSymlinks() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
    defer { try? FileManager.default.removeItem(at: dir) } // only this synthetic directory
    let source = dir.appendingPathComponent("muthoy.restore.db")
    let target = dir.appendingPathComponent("muthoy.db")
    try Data("source".utf8).write(to: source)
    try Data("retained".utf8).write(to: target)
    XCTAssertThrowsError(try atomicMuthoyDatabaseRename(directory: dir, from: "muthoy.restore.db", to: "muthoy.db"))
    XCTAssertEqual(try Data(contentsOf: target), Data("retained".utf8))
    XCTAssertEqual(try Data(contentsOf: source), Data("source".utf8))
    XCTAssertThrowsError(try atomicMuthoyDatabaseRename(directory: dir, from: "../muthoy.restore.db", to: "muthoy.enc.db"))
    try atomicMuthoyDatabaseRename(directory: dir, from: "muthoy.restore.db", to: "muthoy.enc.db")
    XCTAssertEqual(try Data(contentsOf: dir.appendingPathComponent("muthoy.enc.db")), Data("source".utf8))
    try FileManager.default.createSymbolicLink(atPath: source.path, withDestinationPath: target.path)
    XCTAssertThrowsError(try atomicMuthoyDatabaseRename(directory: dir, from: "muthoy.restore.db", to: "muthoy.db.lockedbak"))
  }
}
