// Native XCTest sources only. NOT RUN on the Windows implementation host.
import XCTest
import Security
@testable import MuthoyPinCrypto

final class MuthoyPinCryptoContractTests: XCTestCase {
  // Independent bcryptjs cost10 vector; synthetic PIN, never a real account.
  let standard2a = "$2a$10$abcdefghijklmnopqrstuu03XQq4uczTxEDPe3ML4iARROHzHJ0n6"
  func testCrossLibraryBcryptAndNegativePin() throws {
    XCTAssertEqual(try BCryptSwiftModern.hashPassword("1234", withSalt: "$2a$10$abcdefghijklmnopqrstuu"), standard2a)
    XCTAssertTrue(try BCryptSwiftModern.verifyPassword("1234", matchesHash: standard2a))
    XCTAssertTrue(try BCryptSwiftModern.verifyPassword("1234", matchesHash: standard2a.replacingOccurrences(of: "$2a$", with: "$2b$")))
    XCTAssertFalse(try BCryptSwiftModern.verifyPassword("1235", matchesHash: standard2a))
    XCTAssertThrowsError(try BCryptSwiftModern.verifyPassword("1234", matchesHash: "invalid"))
    let generated = try BCryptSwiftModern.hashPassword("1234", config: BCryptConfiguration(rounds: 10, version: .v2a))
    XCTAssertTrue(generated.hasPrefix("$2a$10$"))
    XCTAssertTrue(try BCryptSwiftModern.verifyPassword("1234", matchesHash: generated))
    XCTAssertNotEqual(generated, standard2a)
  }
  func testExactAndroidHmacDomainAndBase64url() {
    let key = Data((0..<32).map { UInt8($0) })
    XCTAssertEqual(muthoyLookupTag(pin: "1234", key: key), "LElEKCnhMYkFpIOnpzKxz_h5jZWMVzd4H-GPkg5P1b8")
    XCTAssertNotEqual(muthoyLookupTag(pin: "1235", key: key), muthoyLookupTag(pin: "1234", key: key))
    XCTAssertNotEqual(muthoyLookupTag(pin: "1234", key: Data(repeating: 1, count: 32)), muthoyLookupTag(pin: "1234", key: key))
  }
  func testLookupKeyPersistsAndOtherServiceIsIsolated() throws {
    let first = "com.muthoy.synthetic-tests." + UUID().uuidString
    let second = "com.muthoy.synthetic-tests." + UUID().uuidString
    defer {
      for service in [first, second] { SecItemDelete([kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service] as CFDictionary) }
    }
    let store = ApplePinLookupKeyStore(service: first)
    let key = try store.getOrCreate()
    XCTAssertEqual(try store.getOrCreate(), key)
    XCTAssertNotEqual(try ApplePinLookupKeyStore(service: second).getOrCreate(), key)
  }
}
