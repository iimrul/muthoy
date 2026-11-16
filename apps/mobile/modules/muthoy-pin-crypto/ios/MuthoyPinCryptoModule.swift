import ExpoModulesCore
import Foundation
import Security
import CryptoKit

// The DB-key startup subscriber creates this excluded marker before JS runs.
// PIN crypto may only read it; never mint a second identity on lazy first use.
func muthoyPinInstallationID() throws -> String {
  guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
    throw NSError(domain: "MU_PIN_CRYPTO_UNAVAILABLE", code: 1)
  }
  let file = support.appendingPathComponent("MuthoyInstallation/installation-v1")
  let values = try file.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
  guard values.isRegularFile == true, values.isSymbolicLink != true,
    let value = String(data: try Data(contentsOf: file), encoding: .utf8),
    let uuid = UUID(uuidString: value), value == uuid.uuidString.lowercased() else {
    throw NSError(domain: "MU_PIN_CRYPTO_UNAVAILABLE", code: 1)
  }
  return value
}

func muthoyLookupTag(pin: String, key: Data) -> String {
  let message = Data("muthoy:device-pin-lookup:v1".utf8) + Data([0]) + Data(pin.utf8)
  let tag = HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: key))
  return Data(tag).base64EncodedString().replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
}

final class ApplePinLookupKeyStore {
  private let service: String
  init(service: String) { self.service = service }
  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
     kSecAttrAccount as String: "pin-lookup-v1", kSecAttrSynchronizable as String: false]
  }
  private func read() throws -> Data? {
    var q = query
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data, data.count == 32,
      data.contains(where: { $0 != 0 }) else { throw failure() }
    return data
  }
  private func failure() -> NSError {
    NSError(domain: "MU_PIN_CRYPTO_UNAVAILABLE", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "MU_PIN_CRYPTO_UNAVAILABLE"])
  }
  func getOrCreate() throws -> Data {
    if let key = try read() { return key }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess,
      bytes.contains(where: { $0 != 0 }) else { throw failure() }
    let key = Data(bytes)
    var q = query
    q[kSecValueData as String] = key
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(q as CFDictionary, nil)
    if status == errSecDuplicateItem, let key = try read() { return key }
    guard status == errSecSuccess else { throw failure() }
    return key
  }
}

public final class MuthoyPinCryptoModule: Module {
  // Serial queue also prevents concurrent first-use lookup-key replacement.
  private let queue = DispatchQueue(label: "com.muthoy.pin-crypto", qos: .userInitiated)
  public func definition() -> ModuleDefinition {
    Name("MuthoyPinCrypto")
    AsyncFunction("hashPinAsync") { (pin: String, cost: Int) throws -> String in
      guard cost == 10 else { throw NSError(domain: "MU_PIN_COST", code: 1) }
      return try BCryptSwiftModern.hashPassword(pin,
        config: BCryptConfiguration(rounds: 10, version: .v2a, maxPasswordLength: 72))
    }.runOnQueue(queue)
    AsyncFunction("verifyPinAsync") { (pin: String, hash: String) -> Bool in
      // Standard 2a/2b only; never accept the known defective 2.0.x legacy mode.
      return (try? BCryptSwiftModern.verifyPassword(pin, matchesHash: hash)) ?? false
    }.runOnQueue(queue)
    AsyncFunction("createLookupTagAsync") { (pin: String) throws -> String in
      guard let bundle = Bundle.main.bundleIdentifier else {
        throw NSError(domain: "MU_PIN_CRYPTO_UNAVAILABLE", code: 1)
      }
      let key = try ApplePinLookupKeyStore(service: bundle + ".muthoy.pin-lookup.v1." + (try muthoyPinInstallationID())).getOrCreate()
      return muthoyLookupTag(pin: pin, key: key)
    }.runOnQueue(queue)
  }
}
