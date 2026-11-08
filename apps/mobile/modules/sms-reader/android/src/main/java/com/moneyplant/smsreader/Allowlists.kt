package com.moneyplant.smsreader

import android.content.Context

/**
 * Copies of lists in packages/parser/src/senders.ts: BANK_SENDER_TOKENS,
 * UPI_APP_PACKAGES and MONEY_WORDS. The receiver needs them before any
 * JavaScript runs. A parser test checks they match.
 */
internal object Allowlists {
  val bankSenderTokens = listOf("HDFC", "ICICI", "HSBC", "SBI", "SLICE", "SLCEIT")

  val upiAppPackages = setOf(
    "com.google.android.apps.nbu.paisa.user",
    "com.phonepe.app",
    "com.csam.icici.bank.imobile",
    "com.snapwork.hdfc",
    "com.sbi.lotusintouch",
    "com.sbi.upi",
    "com.hsbc.hsbcindia",
    "indwin.c3.shareapp",
    "net.one97.paytm",
    "com.dreamplug.androidapp",
    "in.org.npci.upiapp",
    "com.naviapp",
    "money.super.payments",
    "in.amazon.mShop.android.shopping",
  )

  val moneyWords = listOf(
    "debited", "credited", "spent", "paid", "received", "withdrawn", "withdrawal", "purchase", "deducted",
    "sent", "deposited", "transferred", "refund", "refunded", "reversed", "charged", "payment", "txn", "transaction",
  )

  private val moneyWord = Regex("\\b(?:${moneyWords.joinToString("|")})\\b", RegexOption.IGNORE_CASE)
  private val taggedAmount = Regex(
    "(?:\\b(?:rs|inr|[a-z]{3})\\.?|[₹$€£¥])\\s?\\d|\\d[\\d,.]*\\s?(?:\\b[a-z]{3}\\b|[₹$€£¥])",
    RegexOption.IGNORE_CASE,
  )
  private val otp = Regex("\\bOTP\\b|one[- ]time password|verification code", RegexOption.IGNORE_CASE)

  /** Old loose filter by bank name, kept for the inbox call from older JavaScript. */
  fun isCandidateBankSender(address: String?, tokens: List<String> = bankSenderTokens): Boolean {
    if (address.isNullOrBlank()) return false
    val upper = address.uppercase()
    return tokens.any { upper.contains(it) }
  }

  /** CAP-11: an alphanumeric header or a short code. Phone numbers are people and never read. */
  fun isBusinessSender(address: String?): Boolean {
    val trimmed = address?.trim().orEmpty()
    if (trimmed.isEmpty()) return false
    val compact = trimmed.replace(Regex("[\\s-]"), "")
    if (Regex("^\\+?\\d{7,}$").matches(compact)) return false
    return Regex("^\\d{3,6}$").matches(trimmed) || trimmed.any { it.isLetter() }
  }

  /** An amount and a money word, and not a one-time password. */
  fun looksLikeMoney(text: String): Boolean = !otp.containsMatchIn(text) && moneyWord.containsMatchIn(text) && taggedAmount.containsMatchIn(text)

  /** CAP-11: a message worth handing to JavaScript. Senders the user ignored are dropped here. */
  fun isMoneySms(context: Context, address: String?, body: String): Boolean {
    if (!isBusinessSender(address)) return false
    if (normalise(address!!) in CaptureFilters.ignoredSenders(context)) return false
    return looksLikeMoney(body)
  }

  /** "VM-HDFCBK-S" as "HDFCBK", as normaliseSender in packages/parser does. */
  fun normalise(address: String): String =
    address.trim().uppercase().replace(Regex("^[A-Z0-9]{2}-"), "").replace(Regex("-[A-Z]$"), "")
}

/**
 * What the user chose in Settings → Capture, kept where the receiver and the
 * listener can read it before JavaScript starts. JavaScript writes it.
 */
internal object CaptureFilters {
  private const val PREFS = "moneyplant.capture"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun ignoredSenders(context: Context): Set<String> = prefs(context).getStringSet("ignoredSenders", emptySet()) ?: emptySet()
  fun approvedApps(context: Context): Set<String> = prefs(context).getStringSet("approvedApps", emptySet()) ?: emptySet()
  fun deniedApps(context: Context): Set<String> = prefs(context).getStringSet("deniedApps", emptySet()) ?: emptySet()

  fun save(context: Context, ignoredSenders: List<String>, approvedApps: List<String>, deniedApps: List<String>) {
    prefs(context).edit()
      .putStringSet("ignoredSenders", ignoredSenders.map { it.uppercase() }.toSet())
      .putStringSet("approvedApps", approvedApps.toSet())
      .putStringSet("deniedApps", deniedApps.toSet())
      .apply()
  }
}
