package com.moneyplant.smsreader

import android.app.Notification
import android.content.pm.PackageManager
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Reads payment notifications (CAP-3, CAP-12). Built-in UPI and bank apps,
 * and apps the user said yes to, are read in full. From any other app, a
 * notification about money only tells JavaScript the app's name, never its
 * text, so Review can ask once whether to read that app. Apps the user said
 * no to, and notifications not about money, are dropped unread.
 */
class PaymentNotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    val packageName = notification.packageName ?: return
    if (packageName == applicationContext.packageName) return
    // Group summaries repeat what the individual notifications say.
    if (notification.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    val builtIn = packageName in Allowlists.upiAppPackages
    val approved = builtIn || packageName in CaptureFilters.approvedApps(applicationContext)
    if (!approved && packageName in CaptureFilters.deniedApps(applicationContext)) return

    val extras = notification.notification.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
    val text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))
      ?.toString()
      .orEmpty()
    if (title.isBlank() && text.isBlank()) return
    if (!builtIn && !Allowlists.looksLikeMoney("$title\n$text")) return

    val taskExtras = Bundle().apply {
      putString("packageName", packageName)
      putDouble("receivedAt", notification.postTime.toDouble())
      if (approved) {
        putString("kind", "notification")
        putString("title", title)
        putString("text", text)
      } else {
        // Only the app's name: the user hasn't said this app may be read.
        putString("kind", "app_candidate")
        putString("appName", appName(packageName))
      }
    }
    CaptureTaskService.start(applicationContext, taskExtras)
  }

  private fun appName(packageName: String): String =
    try {
      val info = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(info).toString()
    } catch (e: PackageManager.NameNotFoundException) {
      packageName
    }
}
