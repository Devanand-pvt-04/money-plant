package com.moneyplant.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Telephony

/**
 * Receives every incoming SMS, keeps only those from bank-like senders and
 * passes them to the capture task. Receiving an SMS puts the app on Android's
 * temporary allowlist, so starting the service from here is allowed.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return

    // Long messages arrive in parts; join them per sender.
    val bySender = linkedMapOf<String, StringBuilder>()
    val sentAt = linkedMapOf<String, Long>()
    for (part in parts) {
      val sender = part?.displayOriginatingAddress ?: continue
      if (!Allowlists.isCandidateBankSender(sender)) continue
      bySender.getOrPut(sender) { StringBuilder() }.append(part.displayMessageBody ?: "")
      // The service centre timestamp, which the SMS inbox stores as date_sent.
      sentAt.putIfAbsent(sender, part.timestampMillis)
    }
    val receivedAt = System.currentTimeMillis()

    for ((sender, body) in bySender) {
      val extras = Bundle().apply {
        putString("kind", "sms")
        putString("sender", sender)
        putString("body", body.toString())
        putDouble("receivedAt", receivedAt.toDouble())
        putDouble("sentAt", (sentAt[sender] ?: receivedAt).toDouble())
      }
      CaptureTaskService.start(context, extras)
    }
  }
}
