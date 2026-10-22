package com.moneyplant.smsreader

/**
 * Copies of BANK_SENDER_TOKENS and UPI_APP_PACKAGES in packages/parser/src/senders.ts.
 * The receiver needs them before any JavaScript runs. A parser test checks they match.
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

  /** Loose first filter. Phone numbers never match, so personal SMS stay out of JavaScript. */
  fun isCandidateBankSender(address: String?, tokens: List<String> = bankSenderTokens): Boolean {
    if (address.isNullOrBlank()) return false
    val upper = address.uppercase()
    return tokens.any { upper.contains(it) }
  }
}
