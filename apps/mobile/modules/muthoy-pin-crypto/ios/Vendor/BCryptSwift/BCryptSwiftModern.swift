//
//  BCryptSwiftModern.swift
//  BCryptSwift
//
//  Modern, secure implementation of BCrypt
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import Foundation
import Security

/// Result of `BCryptSwiftModern.verifyPasswordWithLegacySupport(_:matchesHash:)`.
public enum BCryptVerificationResult: Equatable, Sendable {
    /// The password matches the hash.
    case match

    /// The password matches a `$2a$` hash produced by the non-standard BCryptSwift 2.0.0/2.0.1
    /// algorithm. The caller should re-hash the password and replace the stored hash.
    case legacyMatch

    /// The password does not match the hash.
    case noMatch

    /// True for `.match` and `.legacyMatch`.
    public var isMatch: Bool {
        return self != .noMatch
    }
}

/// Modern BCrypt implementation with improved security and Swift patterns
public struct BCryptSwiftModern {

    // MARK: - Public API

    /// Generate a salt with the specified configuration
    /// - Parameter config: The BCrypt configuration
    /// - Returns: A properly formatted BCrypt salt (29 characters)
    /// - Throws: `BCryptError.invalidRounds` if `config.rounds` is outside 4...31,
    ///           `BCryptError.randomGenerationFailed` if secure random generation fails
    public static func generateSalt(config: BCryptConfiguration = .default) throws -> String {
        try config.validate()

        var randomBytes = try BCryptSwiftRandom.generateSecureRandomBytes(count: BCryptConstants.saltLength)
        defer { secureZero(&randomBytes) }

        return header(version: config.version, rounds: Int(config.rounds)) + encodeBase64(randomBytes)
    }

    /// Hash a password using the provided salt.
    ///
    /// Per the bcrypt specification, only the first 72 bytes of the UTF-8 encoded password are used.
    /// Use `hashPassword(_:config:)` to reject long passwords instead of truncating them.
    /// - Parameters:
    ///   - password: The password to hash
    ///   - salt: A 29-character salt (`$2a$10$` + 22 characters) or a full 60-character hash
    /// - Returns: The hashed password
    /// - Throws: `BCryptError` if the salt is malformed
    public static func hashPassword(_ password: String, withSalt salt: String) throws -> String {
        let parsed = try ParsedSalt(parsing: salt, requireFullHash: false)
        return computeHash(password, parsed: parsed, legacyOmitTerminator: false)
    }

    /// Generate a fresh salt and hash a password with it.
    /// - Parameters:
    ///   - password: The password to hash
    ///   - config: The BCrypt configuration
    /// - Returns: The hashed password
    /// - Throws: `BCryptError.passwordTooLong` if the UTF-8 encoded password exceeds
    ///           `config.maxPasswordLength` bytes, or any error from `generateSalt(config:)`
    public static func hashPassword(_ password: String, config: BCryptConfiguration) throws -> String {
        guard password.utf8.count <= config.maxPasswordLength else {
            throw BCryptError.passwordTooLong
        }
        let salt = try generateSalt(config: config)
        return try hashPassword(password, withSalt: salt)
    }

    /// Verify a password against a hash
    /// - Parameters:
    ///   - password: The password to verify
    ///   - hash: The 60-character hash to verify against
    /// - Returns: True if the password matches, false otherwise
    /// - Throws: `BCryptError` if the hash is malformed
    public static func verifyPassword(_ password: String, matchesHash hash: String) throws -> Bool {
        let parsed = try ParsedSalt(parsing: hash, requireFullHash: true)
        let computed = computeHash(password, parsed: parsed, legacyOmitTerminator: false)
        return constantTimeCompare(computed, hash)
    }

    /// Verify a password, also accepting `$2a$` hashes created by BCryptSwift 2.0.0/2.0.1.
    ///
    /// Versions 2.0.0 and 2.0.1 omitted bcrypt's trailing NUL byte for `$2a$` hashes, so those hashes
    /// are not compatible with other bcrypt implementations. Use this method only while migrating
    /// such hashes: on `.legacyMatch`, re-hash the password and store the new hash.
    /// - Parameters:
    ///   - password: The password to verify
    ///   - hash: The 60-character hash to verify against
    /// - Returns: `.match`, `.legacyMatch` (re-hash recommended) or `.noMatch`
    /// - Throws: `BCryptError` if the hash is malformed
    public static func verifyPasswordWithLegacySupport(_ password: String,
                                                       matchesHash hash: String) throws -> BCryptVerificationResult {
        let parsed = try ParsedSalt(parsing: hash, requireFullHash: true)

        if constantTimeCompare(computeHash(password, parsed: parsed, legacyOmitTerminator: false), hash) {
            return .match
        }

        // The 2.0.x bug only changed the output for $2a$ passwords shorter than 72 bytes
        // (for longer passwords the terminator was truncated away anyway).
        if parsed.version == .v2a, password.utf8.count < BCryptConstants.maxKeyLength,
           constantTimeCompare(computeHash(password, parsed: parsed, legacyOmitTerminator: true), hash) {
            return .legacyMatch
        }

        return .noMatch
    }

    /// Generate a salt and hash a password on a background queue
    /// - Parameters:
    ///   - password: The password to hash
    ///   - config: The BCrypt configuration
    /// - Returns: The hashed password
    /// - Throws: Same errors as `hashPassword(_:config:)`
    @available(iOS 13.0, macOS 10.15, tvOS 13.0, watchOS 6.0, *)
    public static func hashPasswordAsync(_ password: String, config: BCryptConfiguration = .default) async throws -> String {
        return try await runOnBackgroundQueue {
            try hashPassword(password, config: config)
        }
    }

    /// Verify a password on a background queue
    /// - Parameters:
    ///   - password: The password to verify
    ///   - hash: The hash to verify against
    /// - Returns: True if the password matches, false otherwise
    /// - Throws: `BCryptError` if the hash is malformed
    @available(iOS 13.0, macOS 10.15, tvOS 13.0, watchOS 6.0, *)
    public static func verifyPasswordAsync(_ password: String, matchesHash hash: String) async throws -> Bool {
        return try await runOnBackgroundQueue {
            try verifyPassword(password, matchesHash: hash)
        }
    }

    // MARK: - Internal Helpers

    /// Runs CPU-heavy work on a GCD queue so it does not block Swift concurrency's cooperative thread pool.
    @available(iOS 13.0, macOS 10.15, tvOS 13.0, watchOS 6.0, *)
    private static func runOnBackgroundQueue<T>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(with: Result { try work() })
            }
        }
    }

    private static func header(version: BCryptVersion, rounds: Int) -> String {
        let roundsString = rounds < 10 ? "0\(rounds)" : "\(rounds)"
        return version.prefix + roundsString + "$"
    }

    private static func computeHash(_ password: String, parsed: ParsedSalt, legacyOmitTerminator: Bool) -> String {
        // bcrypt key: UTF-8 password bytes + NUL terminator, truncated to 72 bytes.
        let utf8 = password.utf8
        let keyLength = min(utf8.count + (legacyOmitTerminator ? 0 : 1), BCryptConstants.maxKeyLength)
        var key = [UInt8](repeating: 0, count: max(keyLength, 1)) // an empty key is equivalent to a single NUL
        for (index, byte) in utf8.prefix(keyLength).enumerated() {
            key[index] = byte
        }
        defer { secureZero(&key) }

        var hashBytes = BlowfishCore.bcrypt(key: key, salt: parsed.salt, logRounds: parsed.rounds)
        defer { secureZero(&hashBytes) }

        return header(version: parsed.version, rounds: parsed.rounds)
            + encodeBase64(parsed.salt)
            + encodeBase64(hashBytes)
    }

    /// Constant-time string comparison to prevent timing attacks
    static func constantTimeCompare(_ lhs: String, _ rhs: String) -> Bool {
        let lhsBytes = Array(lhs.utf8)
        let rhsBytes = Array(rhs.utf8)

        guard lhsBytes.count == rhsBytes.count else { return false }

        var difference: UInt8 = 0
        for index in 0..<lhsBytes.count {
            difference |= lhsBytes[index] ^ rhsBytes[index]
        }

        return difference == 0
    }

    // MARK: - Base64 Encoding/Decoding (bcrypt alphabet, no padding)

    static func encodeBase64(_ data: [UInt8]) -> String {
        let alphabet = BCryptConstants.base64Alphabet
        var output = [UInt8]()
        output.reserveCapacity((data.count * 4 + 2) / 3)

        var offset = 0
        while offset < data.count {
            let c1 = data[offset]
            offset += 1
            output.append(alphabet[Int(c1 >> 2)])
            var bits = (c1 & 0x03) << 4

            guard offset < data.count else {
                output.append(alphabet[Int(bits)])
                break
            }

            let c2 = data[offset]
            offset += 1
            bits |= c2 >> 4
            output.append(alphabet[Int(bits)])
            bits = (c2 & 0x0f) << 2

            guard offset < data.count else {
                output.append(alphabet[Int(bits)])
                break
            }

            let c3 = data[offset]
            offset += 1
            bits |= c3 >> 6
            output.append(alphabet[Int(bits)])
            output.append(alphabet[Int(c3 & 0x3f)])
        }

        return String(decoding: output, as: UTF8.self)
    }

    /// Strictly decodes `characters` into exactly `byteCount` bytes. Returns nil on any invalid character
    /// or if there are not enough characters.
    static func decodeBase64<C: Collection>(_ characters: C, byteCount: Int) -> [UInt8]? where C.Element == UInt8 {
        guard characters.count >= (byteCount * 4 + 2) / 3 else { return nil }

        var values = [UInt8]()
        values.reserveCapacity(characters.count)
        for char in characters {
            guard let value = base64Value(char) else { return nil }
            values.append(value)
        }

        var output = [UInt8]()
        output.reserveCapacity(byteCount)
        var index = 0
        while output.count < byteCount {
            let c1 = values[index], c2 = values[index + 1]
            output.append((c1 << 2) | ((c2 & 0x30) >> 4))
            if output.count == byteCount { break }

            let c3 = values[index + 2]
            output.append(((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2))
            if output.count == byteCount { break }

            let c4 = values[index + 3]
            output.append(((c3 & 0x03) << 6) | c4)
            index += 4
        }

        return output
    }

    static func base64Value(_ char: UInt8) -> UInt8? {
        guard char < 128 else { return nil }
        let value = BCryptConstants.base64Index[Int(char)]
        return value >= 0 ? UInt8(value) : nil
    }
}

// MARK: - Salt / Hash Parsing

/// A strictly validated `$2x$NN$<22 salt chars>[<31 hash chars>]` string.
private struct ParsedSalt {
    static let saltStringLength = 29
    static let hashStringLength = 60

    let version: BCryptVersion
    let rounds: Int
    let salt: [UInt8]

    init(parsing string: String, requireFullHash: Bool) throws {
        let bytes = Array(string.utf8)
        let dollar = UInt8(ascii: "$")

        guard !bytes.isEmpty else {
            throw BCryptError.invalidSalt("Salt is empty")
        }

        guard bytes.count >= 7, bytes[0] == dollar, bytes[3] == dollar, bytes[6] == dollar else {
            throw BCryptError.invalidSalt("Invalid format: expected $2a$NN$ prefix")
        }

        let versionString = String(decoding: bytes[1..<3], as: UTF8.self)
        guard let version = BCryptVersion(rawValue: versionString) else {
            throw BCryptError.invalidVersion(versionString)
        }

        let zero = UInt8(ascii: "0"), nine = UInt8(ascii: "9")
        guard (zero...nine).contains(bytes[4]), (zero...nine).contains(bytes[5]) else {
            throw BCryptError.invalidSalt("Cost factor must be two digits")
        }
        let rounds = Int(bytes[4] - zero) * 10 + Int(bytes[5] - zero)
        guard BCryptConfiguration.validRounds.contains(UInt(rounds)) else {
            throw BCryptError.invalidRounds(rounds)
        }

        if requireFullHash {
            guard bytes.count == ParsedSalt.hashStringLength else {
                throw BCryptError.invalidHashFormat
            }
        } else {
            guard bytes.count == ParsedSalt.saltStringLength || bytes.count == ParsedSalt.hashStringLength else {
                throw BCryptError.invalidSalt("Expected 29 or 60 characters, got \(bytes.count)")
            }
        }

        let saltChars = bytes[7..<ParsedSalt.saltStringLength]
        guard let salt = BCryptSwiftModern.decodeBase64(saltChars, byteCount: BCryptConstants.saltLength) else {
            throw BCryptError.invalidSalt("Salt contains invalid characters")
        }

        if bytes.count == ParsedSalt.hashStringLength,
           !bytes[ParsedSalt.saltStringLength...].allSatisfy({ BCryptSwiftModern.base64Value($0) != nil }) {
            throw requireFullHash ? BCryptError.invalidHashFormat : BCryptError.invalidSalt("Hash contains invalid characters")
        }

        self.version = version
        self.rounds = rounds
        self.salt = salt
    }
}

// MARK: - Secure Memory Helpers

/// Zeroes memory in a way the optimizer may not elide.
func secureZero(_ pointer: UnsafeMutableRawPointer, byteCount: Int) {
    guard byteCount > 0 else { return }
    _ = memset_s(pointer, byteCount, 0, byteCount)
}

/// Zeroes the contents of a byte array in place.
func secureZero(_ array: inout [UInt8]) {
    array.withUnsafeMutableBytes { buffer in
        if let base = buffer.baseAddress {
            secureZero(base, byteCount: buffer.count)
        }
    }
}

// MARK: - Blowfish / EksBlowfish Core

private enum BlowfishCore {
    private static let pCount = 18
    private static let sCount = 1024

    /// Computes the raw 23-byte bcrypt hash.
    static func bcrypt(key: [UInt8], salt: [UInt8], logRounds: Int) -> [UInt8] {
        precondition(!key.isEmpty && salt.count == BCryptConstants.saltLength && (4...31).contains(logRounds))

        let p = UnsafeMutablePointer<UInt32>.allocate(capacity: pCount)
        let s = UnsafeMutablePointer<UInt32>.allocate(capacity: sCount)
        defer {
            secureZero(p, byteCount: pCount * MemoryLayout<UInt32>.size)
            secureZero(s, byteCount: sCount * MemoryLayout<UInt32>.size)
            p.deallocate()
            s.deallocate()
        }
        BCryptConstants.pOrig.withUnsafeBufferPointer { p.initialize(from: $0.baseAddress!, count: pCount) }
        BCryptConstants.sOrig.withUnsafeBufferPointer { s.initialize(from: $0.baseAddress!, count: sCount) }

        key.withUnsafeBufferPointer { keyBuffer in
            salt.withUnsafeBufferPointer { saltBuffer in
                expandKey(p, s, salt: saltBuffer, key: keyBuffer)

                // UInt64 so 1 << 31 does not overflow on 32-bit platforms (e.g. arm64_32 watchOS).
                let iterations = UInt64(1) << UInt64(logRounds)
                var iteration: UInt64 = 0
                while iteration < iterations {
                    expandKey(p, s, key: keyBuffer)
                    expandKey(p, s, key: saltBuffer)
                    iteration += 1
                }
            }
        }

        var cdata = BCryptConstants.ciphertext
        for _ in 0..<64 {
            for j in stride(from: 0, to: cdata.count, by: 2) {
                var l = cdata[j], r = cdata[j + 1]
                encipher(&l, &r, p, s)
                cdata[j] = l
                cdata[j + 1] = r
            }
        }

        var output = [UInt8]()
        output.reserveCapacity(cdata.count * 4)
        for word in cdata {
            output.append(UInt8(truncatingIfNeeded: word >> 24))
            output.append(UInt8(truncatingIfNeeded: word >> 16))
            output.append(UInt8(truncatingIfNeeded: word >> 8))
            output.append(UInt8(truncatingIfNeeded: word))
        }
        cdata.withUnsafeMutableBytes { secureZero($0.baseAddress!, byteCount: $0.count) }

        // bcrypt only encodes the first 23 of the 24 ciphertext bytes. Zero the dropped byte first.
        output[output.count - 1] = 0
        output.removeLast()
        return output
    }

    @inline(__always)
    private static func feistel(_ x: UInt32, _ s: UnsafeMutablePointer<UInt32>) -> UInt32 {
        let a = s[Int(x >> 24)]
        let b = s[0x100 | Int((x >> 16) & 0xff)]
        let c = s[0x200 | Int((x >> 8) & 0xff)]
        let d = s[0x300 | Int(x & 0xff)]
        return ((a &+ b) ^ c) &+ d
    }

    @inline(__always)
    private static func encipher(_ left: inout UInt32, _ right: inout UInt32,
                                 _ p: UnsafeMutablePointer<UInt32>, _ s: UnsafeMutablePointer<UInt32>) {
        var l = left ^ p[0]
        var r = right
        var i = 0
        while i < BCryptConstants.blowfishRounds {
            r ^= feistel(l, s) ^ p[i + 1]
            l ^= feistel(r, s) ^ p[i + 2]
            i += 2
        }
        left = r ^ p[BCryptConstants.blowfishRounds + 1]
        right = l
    }

    @inline(__always)
    private static func streamToWord(_ data: UnsafeBufferPointer<UInt8>, _ offset: inout Int) -> UInt32 {
        var word: UInt32 = 0
        for _ in 0..<4 {
            word = (word << 8) | UInt32(data[offset])
            offset += 1
            if offset == data.count { offset = 0 }
        }
        return word
    }

    /// Standard Blowfish key expansion.
    private static func expandKey(_ p: UnsafeMutablePointer<UInt32>, _ s: UnsafeMutablePointer<UInt32>,
                                  key: UnsafeBufferPointer<UInt8>) {
        var keyOffset = 0
        for i in 0..<pCount {
            p[i] ^= streamToWord(key, &keyOffset)
        }

        var l: UInt32 = 0, r: UInt32 = 0
        for i in stride(from: 0, to: pCount, by: 2) {
            encipher(&l, &r, p, s)
            p[i] = l
            p[i + 1] = r
        }
        for i in stride(from: 0, to: sCount, by: 2) {
            encipher(&l, &r, p, s)
            s[i] = l
            s[i + 1] = r
        }
    }

    /// EksBlowfish salted key expansion.
    private static func expandKey(_ p: UnsafeMutablePointer<UInt32>, _ s: UnsafeMutablePointer<UInt32>,
                                  salt: UnsafeBufferPointer<UInt8>, key: UnsafeBufferPointer<UInt8>) {
        var keyOffset = 0
        for i in 0..<pCount {
            p[i] ^= streamToWord(key, &keyOffset)
        }

        var saltOffset = 0
        var l: UInt32 = 0, r: UInt32 = 0
        for i in stride(from: 0, to: pCount, by: 2) {
            l ^= streamToWord(salt, &saltOffset)
            r ^= streamToWord(salt, &saltOffset)
            encipher(&l, &r, p, s)
            p[i] = l
            p[i + 1] = r
        }
        for i in stride(from: 0, to: sCount, by: 2) {
            l ^= streamToWord(salt, &saltOffset)
            r ^= streamToWord(salt, &saltOffset)
            encipher(&l, &r, p, s)
            s[i] = l
            s[i + 1] = r
        }
    }
}
