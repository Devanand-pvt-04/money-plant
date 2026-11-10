package com.moneyplant.smsreader

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads payment notifications from the built-in UPI and bank apps (CAP-3),
 * to add payee names to SMS entries. Every other app's notifications are
 * dropped unread (decision 0019).
 */
class PaymentNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    val packageName = notification.packageName ?: return
    if (packageName == applicationContext.packageName) return
    // Group summaries repeat what the individual notifications say.
    if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    if (packageName !in Allowlists.upiAppPackages) return

    val extras = notification.notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString()
      .orEmpty()
    if (title.isBlank() && text.isBlank()) return

    val taskExtras = Bundle().apply {
      putString("packageName", packageName)
      putDouble("receivedAt", notification.postTime.toDouble())
      putString("kind", "notification")
      putString("title", title)
      putString("text", text)
    }
    CaptureTaskService.start(applicationContext, taskExtras)
  }
}
