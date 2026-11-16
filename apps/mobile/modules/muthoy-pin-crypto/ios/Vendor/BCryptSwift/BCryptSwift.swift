//
//  BCryptSwift.swift
//  BCryptSwift
//
//  Created by Felipe Florencio Garcia on 3/14/17.
//  Copyright © 2017 Felipe Florencio Garcia. All rights reserved.
//
//  Originally created by Joe Kramer https://github.com/meanjoe45/JKBCrypt
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

// MARK: - BCryptSwift Public API (Legacy Compatible)

/// Legacy BCryptSwift class for backward compatibility with the 1.x API.
/// New code should use `BCryptSwiftModern` instead.
public class BCryptSwift: NSObject {

    /// Generate a salt with the specified number of rounds.
    ///
    /// For 1.x compatibility, out-of-range values are clamped to 4...31.
    /// - Parameter rounds: The cost factor (4-31)
    /// - Returns: A properly formatted BCrypt salt, or an empty string if secure random generation fails
    @objc public class func generateSaltWithNumberOfRounds(_ rounds: UInt) -> String {
        let config = BCryptConfiguration(rounds: min(max(rounds, 4), 31))
        return (try? BCryptSwiftModern.generateSalt(config: config)) ?? ""
    }

    /// Generate a salt with the default cost factor (10).
    /// - Returns: A properly formatted BCrypt salt, or an empty string if secure random generation fails
    @objc public class func generateSalt() -> String {
        return generateSaltWithNumberOfRounds(BCryptConfiguration.default.rounds)
    }

    /// Hash a password with the provided salt.
    /// - Parameters:
    ///   - password: The password to hash
    ///   - salt: The salt to use
    /// - Returns: The hashed password, or nil if an error occurs
    @objc public class func hashPassword(_ password: String, withSalt salt: String) -> String? {
        return try? BCryptSwiftModern.hashPassword(password, withSalt: salt)
    }

    /// Verify a password against a hash.
    ///
    /// Not exposed to Objective-C because `Bool?` has no Objective-C representation.
    /// - Parameters:
    ///   - password: The password to verify
    ///   - hash: The hash to verify against
    /// - Returns: True if matches, false if not, nil if the hash is malformed
    public class func verifyPassword(_ password: String, matchesHash hash: String) -> Bool? {
        return try? BCryptSwiftModern.verifyPassword(password, matchesHash: hash)
    }
}
