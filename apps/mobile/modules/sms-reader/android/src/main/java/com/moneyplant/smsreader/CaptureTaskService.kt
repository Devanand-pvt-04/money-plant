package com.moneyplant.smsreader

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Hands one captured SMS or notification to the JavaScript task registered as
 * "MoneyPlantCapture" (apps/mobile/index.ts). Starts React if the app is closed.
 */
class CaptureTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.fromBundle(extras),
      TIMEOUT_MS,
      // The same task handles messages while the app is open.
      true,
    )
  }

  companion object {
    const val TASK_KEY = "MoneyPlantCapture"
    private const val TIMEOUT_MS = 60_000L
    private const val TAG = "MoneyPlantCapture"

    fun start(context: Context, extras: Bundle) {
      val intent = Intent(context, CaptureTaskService::class.java).putExtras(extras)
      try {
        context.startService(intent)
        acquireWakeLockNow(context)
      } catch (e: IllegalStateException) {
        // Android refused a background start. The inbox scan on next app open catches SMS up.
        // Never log the message itself.
        Log.w(TAG, "Could not start capture task: ${e.javaClass.simpleName}")
      }
    }
  }
}
