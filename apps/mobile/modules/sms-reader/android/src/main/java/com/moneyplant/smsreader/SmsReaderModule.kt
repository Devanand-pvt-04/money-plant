package com.moneyplant.smsreader

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.provider.Telephony
import android.view.WindowManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsReaderModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    Function("hasSmsPermission") {
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    }

    // Inbox messages from bank-like senders received after `sinceMillis`, oldest first (CAP-2).
    AsyncFunction("readInbox") { sinceMillis: Double, senderTokens: List<String>, limit: Int ->
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
        throw SmsPermissionException()
      }
      val messages = mutableListOf<Map<String, Any>>()
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.DATE_SENT),
        "${Telephony.Sms.DATE} > ?",
        arrayOf(sinceMillis.toLong().toString()),
        "${Telephony.Sms.DATE} ASC",
      )?.use { cursor ->
        val idCol = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
        val addressCol = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyCol = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateCol = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
        val dateSentCol = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE_SENT)
        while (cursor.moveToNext() && messages.size < limit) {
          val address = cursor.getString(addressCol)
          if (!Allowlists.isCandidateBankSender(address, senderTokens)) continue
          val date = cursor.getLong(dateCol)
          val dateSent = cursor.getLong(dateSentCol)
          messages.add(
            mapOf(
              "id" to cursor.getLong(idCol).toString(),
              "sender" to address,
              "body" to (cursor.getString(bodyCol) ?: ""),
              "receivedAt" to date.toDouble(),
              // Same value the receiver sees as the PDU timestamp, so both paths fingerprint a message alike.
              "sentAt" to (if (dateSent > 0) dateSent else date).toDouble(),
            ),
          )
        }
      }
      messages
    }

    Function("isNotificationAccessGranted") {
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
      val component = ComponentName(context, PaymentNotificationListener::class.java)
      enabled.split(':').mapNotNull { ComponentName.unflattenFromString(it) }.any { it == component }
    }

    Function("openNotificationAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // Hides the app in the recent apps view (Android has no way to do that
    // without also blocking screenshots). Lives here so the app needs no extra
    // package, and no screenshot permissions that a capture library declares.
    AsyncFunction("setSecureWindow") { on: Boolean ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction
      if (on) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }.runOnQueue(Queues.MAIN)
  }
}

internal class SmsPermissionException :
  expo.modules.kotlin.exception.CodedException("ERR_SMS_PERMISSION", "SMS permission is not granted", null)
