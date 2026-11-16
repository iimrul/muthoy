//
//  BCryptSwiftRandom.swift
//  BCryptSwift
//
//  Created by Felipe Florencio Garcia on 3/14/17.
//  Copyright © 2017 Felipe Florencio Garcia. All rights reserved.
//
// Originally created by Joe Kramer https://github.com/meanjoe45/JKBCrypt
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

/// Secure random number generation for BCrypt operations
public struct BCryptSwiftRandom {
    
    /// Generate cryptographically secure random bytes
    /// - Parameter length: The number of bytes to generate
    /// - Returns: An array of random bytes
    /// - Throws: BCryptError.randomGenerationFailed if secure random generation fails
    public static func generateSecureRandomBytes(count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        
        guard status == errSecSuccess else {
            throw BCryptError.randomGenerationFailed
        }
        
        return bytes
    }
    
    /// Generate cryptographically secure random signed bytes
    /// - Parameter length: The number of bytes to generate
    /// - Returns: An array of random signed bytes
    /// - Throws: BCryptError.randomGenerationFailed if secure random generation fails
    public static func generateRandomSignedData(ofLength length: Int) throws -> [Int8] {
        guard length >= 1 else {
            return []
        }
        
        let unsignedBytes = try generateSecureRandomBytes(count: length)
        return unsignedBytes.map { Int8(bitPattern: $0) }
    }
    
    /// Generate a cryptographically secure random number within a range
    /// - Parameters:
    ///   - lowerBound: The lower bound (inclusive)
    ///   - upperBound: The upper bound (inclusive)
    /// - Returns: A random number within the specified range
    /// - Throws: BCryptError.randomGenerationFailed if secure random generation fails
    public static func generateSecureRandomNumber(from lowerBound: Int32, to upperBound: Int32) throws -> Int32 {
        let low = Int64(min(lowerBound, upperBound))
        let high = Int64(max(lowerBound, upperBound))

        // Handle edge case where low == high
        if low == high {
            return Int32(low)
        }

        // Computed in 64-bit so the full Int32 range (span 2^32) cannot overflow.
        let span = UInt64(high - low) + 1
        let space = UInt64(1) << 32

        // Rejection sampling to avoid modulo bias: accept only values below the largest multiple of span.
        let limit = space - (space % span)
        var randomValue: UInt64

        repeat {
            var raw: UInt32 = 0
            let status = withUnsafeMutableBytes(of: &raw) { buffer in
                SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
            }
            guard status == errSecSuccess else {
                throw BCryptError.randomGenerationFailed
            }
            randomValue = UInt64(raw)
        } while randomValue >= limit

        return Int32(low + Int64(randomValue % span))
    }

    /// Generate a sequence of random numbers within a range
    /// - Parameters:
    ///   - lowerBound: The lower bound (inclusive)
    ///   - upperBound: The upper bound (inclusive)
    ///   - length: The length of the sequence
    ///   - unique: Whether values should be unique
    /// - Returns: An array of random numbers, or an empty array if `unique` is requested and the range is too small
    /// - Throws: BCryptError.randomGenerationFailed if secure random generation fails
    @available(*, deprecated, message: "Not used by bcrypt; will be removed in a future major version")
    public static func generateNumberSequence(from lowerBound: Int32,
                                              to upperBound: Int32,
                                              ofLength length: Int,
                                              withUniqueValues unique: Bool) throws -> [Int32] {
        guard length >= 1 else {
            return []
        }

        let low = min(lowerBound, upperBound)
        let high = max(lowerBound, upperBound)
        let span = Int64(high) - Int64(low) + 1

        if unique && Int64(length) > span {
            // Cannot generate more unique values than the range allows
            return []
        }

        var sequence = [Int32]()
        sequence.reserveCapacity(length)

        if !unique {
            for _ in 0..<length {
                sequence.append(try generateSecureRandomNumber(from: low, to: high))
            }
        } else if span <= Int64(length) * 4 {
            // Dense request: partial Fisher-Yates shuffle over the (small) range.
            var pool = Array(low...high)
            for index in 0..<length {
                let pick = Int(try generateSecureRandomNumber(from: Int32(index), to: Int32(pool.count - 1)))
                pool.swapAt(index, pick)
                sequence.append(pool[index])
            }
        } else {
            // Sparse request: rejection sampling; memory stays proportional to `length`, not the range.
            var seen = Set<Int32>(minimumCapacity: length)
            while sequence.count < length {
                let number = try generateSecureRandomNumber(from: low, to: high)
                if seen.insert(number).inserted {
                    sequence.append(number)
                }
            }
        }

        return sequence
    }
    
    // MARK: - Legacy API (Deprecated)
    
    @available(*, deprecated, message: "Use generateSecureRandomNumber(from:to:) instead")
    public static func generateNumberBetween(_ first: Int32, _ second: Int32) -> Int32 {
        return (try? generateSecureRandomNumber(from: first, to: second)) ?? first
    }
    
    @available(*, deprecated, message: "Use generateNumberSequence(from:to:ofLength:withUniqueValues:) instead")
    public static func generateNumberSequenceBetween(_ first: Int32, _ second: Int32, ofLength length: Int, withUniqueValues unique: Bool) -> [Int32] {
        return (try? generateNumberSequence(from: first, to: second, ofLength: length, withUniqueValues: unique)) ?? []
    }
    
    @available(*, deprecated, message: "Use generateRandomSignedData(ofLength:) instead")
    public static func generateRandomSignedDataOfLength(_ length: Int) -> [Int8] {
        return (try? generateRandomSignedData(ofLength: length)) ?? []
    }
    
    @available(*, deprecated, message: "Not used by bcrypt; will be removed in a future major version")
    public static func isNumber(_ number: Int32, inSequence sequence: [Int32], ofLength length: Int) -> Bool {
        guard length >= 1, length <= sequence.count else {
            return false
        }
        
        return sequence.prefix(length).contains(number)
    }
}
