package com.muthoy.dbkey

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// H-3. The ONLY place the SQLCipher database key exists in plaintext, and it
// never leaves this module except as the hex string db/client.ts feeds straight
// into `PRAGMA key`. Never logged, never synced, never in telemetry.
//
// Two keys, deliberately. The database key itself is 32 random bytes from
// SecureRandom — SQLCipher's raw-key form, so no KDF and no salt handling — and
// it is persisted ONLY as ciphertext, wrapped by a second AES-256-GCM key
// generated inside AndroidKeyStore that cannot be exported. The wrapped blob
// and its IV live in app-private SharedPreferences, which is useless on its
// own: unwrapping needs the Keystore key, which never leaves secure hardware
// where the device provides it.
//
// Mirrors modules/muthoy-pin-crypto's Keystore pattern (muthoy_pin_lookup_hmac_v1).
//
// The key is deliberately INDEPENDENT of every PIN. PINs change, are per-user
// and shop-scoped; deriving the database key from one would force a full
// re-key on every PIN change, which is a data-loss surface for no security
// gain. It also keeps H-3 and H-4 decoupled.
//
// NO user-authentication binding on the wrapping key. That is not an
// oversight: native/notifications.ts runs a headless background task that
// reads SQLite with no UI and possibly a locked screen.
// setUserAuthenticationRequired(true) would make that task fail every run.
private const val WRAPPING_KEY_ALIAS_PRIMARY = "muthoy_db_master_v1"
private const val WRAPPING_KEY_ALIAS_SECONDARY = "muthoy_db_master_v2"
private const val PREFS_NAME = "muthoy_db_key_v1"
private const val PREF_WRAPPED_KEY = "wrapped_db_key"
private const val PREF_IV = "wrapped_db_key_iv"
private const val PREF_WRAPPING_ALIAS = "wrapped_db_key_alias"
private const val PREF_RECOVERY_PENDING = "recovery_pending"
private const val PREF_RECOVERY_WRAPPED_KEY = "recovery_wrapped_db_key"
private const val PREF_RECOVERY_IV = "recovery_wrapped_db_key_iv"
private const val PREF_RECOVERY_WRAPPING_ALIAS = "recovery_wrapped_db_key_alias"
private const val DB_KEY_LENGTH_BYTES = 32
private const val GCM_TAG_LENGTH_BITS = 128
private const val GCM_IV_LENGTH_BYTES = 12
private const val AES_GCM_NO_PADDING = "AES/GCM/NoPadding"

// Raised when a wrapped key exists but cannot be unwrapped — the Keystore key
// was destroyed (reinstall, some factory-reset/restore paths, or a lock-screen
// credential change that invalidated it) while the ciphertext survived. The
// database is then unreadable and MUST NOT be replaced with an empty one;
// recovery is a re-sync from the server (H-11).
private const val ERROR_UNRECOVERABLE = "MU_DBKEY_UNRECOVERABLE"
private const val ERROR_UNAVAILABLE = "MU_DBKEY_UNAVAILABLE"

private val DATABASE_FILE_NAMES = setOf(
  "muthoy.db",
  "muthoy.enc.db",
  "muthoy.restore.db",
  "muthoy.db.plainbak",
  "muthoy.db.lockedbak",
)
private val DATABASE_SIDECAR_SUFFIXES = setOf("-journal", "-wal", "-shm")

class MuthoyDbKeyModule : Module() {
  private fun context(): Context =
    appContext.reactContext ?: throw IllegalStateException("Android context unavailable")

  private fun prefs() = context().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("MuthoyDbKey")

    // Whether a wrapped database key has already been stored. Distinguishes a
    // fresh install (false — safe to generate) from a device that already has
    // an encrypted database (true). The caller pairs this with the on-disk
    // database state so a missing key can never be answered by silently
    // creating a new empty database.
    // Direct-return rather than an explicit `Promise` parameter, matching
    // modules/muthoy-pin-crypto. This is the form verified on a real device:
    // the key is minted, persisted and read back correctly across restarts.
    //
    // An earlier comment here claimed the `Promise`-parameter form hung app
    // boot. That was a misattribution: the blank screen blamed on it came from
    // a validation harness launching an activity name that does not exist, not
    // from this module. Direct-return is kept because it is the proven form
    // and needs no argument plumbing, not because the alternative is broken.
    AsyncFunction("hasDatabaseKeyAsync") {
      hasWrappedKey()
    }

    // Returns the database key as 64 lowercase hex characters, generating and
    // wrapping one on first call. Every later call returns the same key for
    // the life of the install.
    AsyncFunction("getOrCreateDatabaseKeyHexAsync") {
      // The error CODE travels in the message because a thrown exception is
      // what the direct-return style surfaces. db/databaseKey.ts matches on
      // both `.code` and the message, so either shape maps to the right
      // typed error.
      try {
        toHexAndClear(getOrCreateDatabaseKey())
      } catch (error: DatabaseKeyUnrecoverable) {
        throw Exception("$ERROR_UNRECOVERABLE: ${error.message}", error)
      } catch (error: Exception) {
        throw Exception("$ERROR_UNAVAILABLE: ${error.message}", error)
      }
    }

    AsyncFunction("hasPendingDatabaseKeyRecoveryAsync") {
      prefs().getBoolean(PREF_RECOVERY_PENDING, false)
    }

    // Called only after device-login has authenticated the operator against
    // the server. Preserve the prior wrapped bytes before minting a replacement
    // key so the locked database remains recoverable until hydration succeeds.
    AsyncFunction("beginDatabaseKeyRecoveryAsync") {
      try {
        toHexAndClear(beginDatabaseKeyRecovery())
      } catch (error: Exception) {
        throw Exception("$ERROR_UNAVAILABLE: ${error.message}", error)
      }
    }

    AsyncFunction("completeDatabaseKeyRecoveryAsync") {
      try {
        completeDatabaseKeyRecovery()
      } catch (error: Exception) {
        throw Exception("$ERROR_UNAVAILABLE: ${error.message}", error)
      }
    }

    // Os.rename delegates to POSIX rename(2), atomic within this one
    // app-private directory on every supported Android API. Expo File.rename
    // uses copy-then-delete on API 24/25 and is unsafe for the database swap.
    Function("atomicRenameDatabaseFile") { fromFileName: String, toFileName: String ->
      atomicRenameDatabaseFile(fromFileName, toFileName)
    }
  }

  private class DatabaseKeyUnrecoverable(message: String, cause: Throwable?) :
    Exception(message, cause)

  private fun hasWrappedKey(): Boolean {
    val preferences = prefs()
    return preferences.contains(PREF_WRAPPED_KEY) && preferences.contains(PREF_IV)
  }

  @Synchronized
  private fun getOrCreateDatabaseKey(): ByteArray {
    val preferences = prefs()
    val wrapped = preferences.getString(PREF_WRAPPED_KEY, null)
    val iv = preferences.getString(PREF_IV, null)
    val wrappingAlias = activeWrappingAlias(preferences.getString(PREF_WRAPPING_ALIAS, null))

    if (wrapped != null && iv != null) {
      val decoded = try {
        Pair(Base64.decode(wrapped, Base64.NO_WRAP), Base64.decode(iv, Base64.NO_WRAP))
      } catch (error: IllegalArgumentException) {
        throw DatabaseKeyUnrecoverable("Stored database key encoding is malformed", error)
      }
      return unwrap(decoded.first, decoded.second, wrappingAlias)
    }

    // A half-written pair means an interrupted first run, never a usable key.
    // Clearing it is safe precisely because no database was ever encrypted
    // with it: a key that was only half-persisted was never handed to
    // SQLCipher.
    if (wrapped != null || iv != null) {
      preferences.edit()
        .remove(PREF_WRAPPED_KEY)
        .remove(PREF_IV)
        .remove(PREF_WRAPPING_ALIAS)
        .commit()
    }

    val databaseKey = ByteArray(DB_KEY_LENGTH_BYTES).also { SecureRandom().nextBytes(it) }
    val cipher = Cipher.getInstance(AES_GCM_NO_PADDING).apply {
      init(Cipher.ENCRYPT_MODE, getOrCreateWrappingKey(wrappingAlias))
    }
    val ciphertext = cipher.doFinal(databaseKey)

    // commit(), not apply(): the key must be durably on disk BEFORE any
    // database is encrypted with it. An async write that lost a race with a
    // crash would leave ciphertext no one can ever open.
    val stored = preferences.edit()
      .putString(PREF_WRAPPED_KEY, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
      .putString(PREF_IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString(PREF_WRAPPING_ALIAS, wrappingAlias)
      .commit()
    if (!stored) {
      throw IllegalStateException("Failed to persist the wrapped database key")
    }
    return databaseKey
  }

  @Synchronized
  private fun beginDatabaseKeyRecovery(): ByteArray {
    val preferences = prefs()
    if (!preferences.getBoolean(PREF_RECOVERY_PENDING, false)) {
      val oldAlias = activeWrappingAlias(preferences.getString(PREF_WRAPPING_ALIAS, null))
      val newAlias = alternateWrappingAlias(oldAlias)
      // The alternate slot cannot protect the active key. Clearing an old,
      // unused entry first means an invalidated alias can never block recovery,
      // while the active old alias remains untouched and recoverable.
      KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(newAlias)
      val editor = preferences.edit()
      preferences.getString(PREF_WRAPPED_KEY, null)?.let {
        editor.putString(PREF_RECOVERY_WRAPPED_KEY, it)
      }
      preferences.getString(PREF_IV, null)?.let {
        editor.putString(PREF_RECOVERY_IV, it)
      }
      editor.putString(PREF_RECOVERY_WRAPPING_ALIAS, oldAlias)
      val stored = editor
        .remove(PREF_WRAPPED_KEY)
        .remove(PREF_IV)
        .putString(PREF_WRAPPING_ALIAS, newAlias)
        .putBoolean(PREF_RECOVERY_PENDING, true)
        .commit()
      if (!stored) {
        throw IllegalStateException("Failed to preserve the prior database key state")
      }
    }
    return getOrCreateDatabaseKey()
  }

  @Synchronized
  private fun completeDatabaseKeyRecovery() {
    val preferences = prefs()
    if (!preferences.getBoolean(PREF_RECOVERY_PENDING, false)) return
    val oldAlias = preferences.getString(PREF_RECOVERY_WRAPPING_ALIAS, null)
    val currentAlias = activeWrappingAlias(preferences.getString(PREF_WRAPPING_ALIAS, null))
    if (
      (oldAlias != WRAPPING_KEY_ALIAS_PRIMARY && oldAlias != WRAPPING_KEY_ALIAS_SECONDARY) ||
      oldAlias == currentAlias
    ) {
      throw IllegalStateException("Database key recovery aliases are inconsistent")
    }
    KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(oldAlias)
    val stored = preferences.edit()
      .remove(PREF_RECOVERY_WRAPPED_KEY)
      .remove(PREF_RECOVERY_IV)
      .remove(PREF_RECOVERY_WRAPPING_ALIAS)
      .remove(PREF_RECOVERY_PENDING)
      .commit()
    if (!stored) {
      throw IllegalStateException("failed to finalize database key recovery")
    }
  }

  private fun atomicRenameDatabaseFile(fromFileName: String, toFileName: String) {
    requireAllowedDatabaseFileName(fromFileName)
    requireAllowedDatabaseFileName(toFileName)
    val directory = File(context().filesDir, "SQLite")
    val source = File(directory, fromFileName)
    val target = File(directory, toFileName)
    if (!source.exists()) {
      throw IllegalStateException("Database rename source is missing")
    }
    if (target.exists()) {
      throw IllegalStateException("Database rename target already exists")
    }
    Os.rename(source.absolutePath, target.absolutePath)
    // rename(2) is atomic, but its directory entry is not crash-durable until
    // the containing directory is synced. Required on API 24/25 too.
    val directoryDescriptor = Os.open(
      directory.absolutePath,
      OsConstants.O_RDONLY,
      0,
    )
    try {
      Os.fsync(directoryDescriptor)
    } finally {
      Os.close(directoryDescriptor)
    }
  }

  private fun requireAllowedDatabaseFileName(fileName: String) {
    val allowed = DATABASE_FILE_NAMES.any { candidate ->
      fileName == candidate || DATABASE_SIDECAR_SUFFIXES.any { suffix ->
        fileName == candidate + suffix
      }
    }
    if (!allowed || fileName.contains('/') || fileName.contains('\\')) {
      throw IllegalArgumentException("Refusing database rename outside the H-3 file set")
    }
  }

  private fun unwrap(ciphertext: ByteArray, iv: ByteArray, wrappingAlias: String): ByteArray {
    if (iv.size != GCM_IV_LENGTH_BYTES) {
      throw DatabaseKeyUnrecoverable("Stored database key IV is malformed", null)
    }
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val wrappingKey = (keyStore.getKey(wrappingAlias, null) as? SecretKey)
      ?: throw DatabaseKeyUnrecoverable(
        "The AndroidKeyStore key protecting the local database is gone",
        null,
      )
    val plaintext = try {
      Cipher.getInstance(AES_GCM_NO_PADDING).run {
        init(Cipher.DECRYPT_MODE, wrappingKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        doFinal(ciphertext)
      }
    } catch (error: Exception) {
      throw DatabaseKeyUnrecoverable("The wrapped database key could not be decrypted", error)
    }
    if (plaintext.size != DB_KEY_LENGTH_BYTES) {
      throw DatabaseKeyUnrecoverable("Unwrapped database key has the wrong length", null)
    }
    return plaintext
  }

  private fun activeWrappingAlias(storedAlias: String?): String {
    if (storedAlias == null) return WRAPPING_KEY_ALIAS_PRIMARY
    if (storedAlias == WRAPPING_KEY_ALIAS_PRIMARY || storedAlias == WRAPPING_KEY_ALIAS_SECONDARY) {
      return storedAlias
    }
    throw DatabaseKeyUnrecoverable("Stored wrapping-key alias is malformed", null)
  }

  private fun alternateWrappingAlias(activeAlias: String): String =
    if (activeAlias == WRAPPING_KEY_ALIAS_PRIMARY) {
      WRAPPING_KEY_ALIAS_SECONDARY
    } else {
      WRAPPING_KEY_ALIAS_PRIMARY
    }

  private fun getOrCreateWrappingKey(wrappingAlias: String): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(wrappingAlias, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        wrappingAlias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        // Headless background work must reach the database; see the note above.
        .setUserAuthenticationRequired(false)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  private fun toHex(bytes: ByteArray): String {
    val out = StringBuilder(bytes.size * 2)
    for (byte in bytes) out.append("%02x".format(byte))
    return out.toString()
  }

  private fun toHexAndClear(bytes: ByteArray): String = try {
    toHex(bytes)
  } finally {
    // The JS string must exist long enough to configure SQLCipher. Do not also
    // leave a second mutable plaintext copy waiting for native GC.
    bytes.fill(0)
  }
}
