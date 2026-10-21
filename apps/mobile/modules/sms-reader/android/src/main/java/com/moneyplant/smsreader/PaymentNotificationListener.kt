package com.moneyplant.smsreader

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads notifications from UPI and bank apps only, to add payee names to
 * entries (CAP-3). Every other app's notifications are dropped unread.
 */
class PaymentNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    if (notification.packageName !in Allowlists.upiAppPackages) return
    // Group summaries repeat what the individual notifications say.
    if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return

    val extras = notification.notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString()
      .orEmpty()
    if (title.isBlank() && text.isBlank()) return

    val taskExtras = Bundle().apply {
      putString("kind", "notification")
      putString("packageName", notification.packageName)
      putString("title", title)
      putString("text", text)
      putDouble("receivedAt", notification.postTime.toDouble())
    }
    CaptureTaskService.start(applicationContext, taskExtras)
  }
}
