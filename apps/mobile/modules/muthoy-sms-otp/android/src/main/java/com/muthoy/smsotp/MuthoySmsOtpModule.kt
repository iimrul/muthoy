package com.muthoy.smsotp

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Muthoy SMS one-time-code reader (founder request 2026-11-25).
//
// Google's SMS User Consent API: after `waitForSmsWithConsent`, the next SMS
// that contains a one-time code makes Android itself ask the owner "Allow
// Muthoy to read this message?". Only on Allow does that ONE message's text
// reach the app; nothing else is read, no SMS permission is requested, and the
// text is returned to JS and never stored here. Times out after 5 minutes
// (Google's window), resolving null, exactly like a denial.
class MuthoySmsOtpModule : Module() {
  private var pending: Promise? = null
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("MuthoySmsOtp")

    AsyncFunction("waitForSmsWithConsent") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // One wait at a time: a new request (a resend) replaces the old one.
      settle(null)
      pending = promise
      registerReceiver(context)
      SmsRetriever.getClient(context)
        .startSmsUserConsent(null)
        .addOnFailureListener { settle(null) }
    }

    Function("cancel") {
      settle(null)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != CONSENT_REQUEST) return@OnActivityResult
      val message = if (payload.resultCode == Activity.RESULT_OK) {
        payload.data?.getStringExtra(SmsRetriever.EXTRA_SMS_MESSAGE)
      } else {
        null
      }
      settle(message)
    }

    OnDestroy {
      settle(null)
    }
  }

  private fun registerReceiver(context: Context) {
    val next = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != SmsRetriever.SMS_RETRIEVED_ACTION) return
        val extras = intent.extras ?: return settle(null)
        val status = statusOf(extras) ?: return settle(null)
        if (status.statusCode != CommonStatusCodes.SUCCESS) return settle(null)
        val consent = consentIntentOf(extras)
        val activity = appContext.currentActivity
        if (consent == null || activity == null || !isGoogleConsentPrompt(activity, consent)) {
          return settle(null)
        }
        // The consent intent comes from another app: never let it carry URI
        // grants back to us (Android intent-redirection guidance).
        consent.removeFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
        try {
          activity.startActivityForResult(consent, CONSENT_REQUEST)
        } catch (_: Exception) {
          settle(null)
        }
      }
    }
    val filter = IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(next, filter, SmsRetriever.SEND_PERMISSION, null, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      context.registerReceiver(next, filter, SmsRetriever.SEND_PERMISSION, null)
    }
    receiver = next
  }

  // Only Google Play services' own consent screen may be launched from here.
  private fun isGoogleConsentPrompt(activity: Activity, consent: Intent): Boolean {
    val target = consent.resolveActivity(activity.packageManager) ?: return false
    return target.packageName == GOOGLE_PLAY_SERVICES
  }

  private fun statusOf(extras: Bundle): Status? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      extras.getParcelable(SmsRetriever.EXTRA_STATUS, Status::class.java)
    } else {
      @Suppress("DEPRECATION")
      extras.get(SmsRetriever.EXTRA_STATUS) as? Status
    }

  private fun consentIntentOf(extras: Bundle): Intent? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      extras.getParcelable(SmsRetriever.EXTRA_CONSENT_INTENT)
    }

  private fun settle(message: String?) {
    receiver?.let { registered ->
      try {
        appContext.reactContext?.unregisterReceiver(registered)
      } catch (_: Exception) {
        // Already unregistered: nothing to undo.
      }
    }
    receiver = null
    val waiting = pending
    pending = null
    waiting?.resolve(message)
  }

  companion object {
    private const val CONSENT_REQUEST = 4207
    private const val GOOGLE_PLAY_SERVICES = "com.google.android.gms"
  }
}
