package com.muthoy.pincrypto

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import at.favre.lib.crypto.bcrypt.BCrypt
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

private const val BCRYPT_COST = 10
private const val LOOKUP_KEY_ALIAS = "muthoy_pin_lookup_hmac_v1"
private const val LOOKUP_DOMAIN = "muthoy:device-pin-lookup:v1"

class MuthoyPinCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MuthoyPinCrypto")

    AsyncFunction("hashPinAsync") { rawPin: String, cost: Int ->
      require(cost == BCRYPT_COST) { "PIN bcrypt cost must remain $BCRYPT_COST" }
      BCrypt.withDefaults().hashToString(cost, rawPin.toCharArray())
    }

    AsyncFunction("verifyPinAsync") { rawPin: String, hash: String ->
      BCrypt.verifyer().verify(rawPin.toCharArray(), hash.toCharArray()).verified
    }

    AsyncFunction("createLookupTagAsync") { rawPin: String ->
      val mac = Mac.getInstance("HmacSHA256")
      mac.init(getOrCreateLookupKey())
      mac.update(LOOKUP_DOMAIN.toByteArray(StandardCharsets.UTF_8))
      mac.update(0.toByte())
      val tag = mac.doFinal(rawPin.toByteArray(StandardCharsets.UTF_8))
      Base64.encodeToString(tag, Base64.NO_WRAP or Base64.NO_PADDING or Base64.URL_SAFE)
    }
  }

  private fun getOrCreateLookupKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(LOOKUP_KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        LOOKUP_KEY_ALIAS,
        KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
      )
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build(),
    )
    return generator.generateKey()
  }
}
