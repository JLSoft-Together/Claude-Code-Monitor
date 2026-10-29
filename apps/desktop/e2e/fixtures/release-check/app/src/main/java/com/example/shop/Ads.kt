package com.example.shop

object Ads {
    const val BANNER = "ca-app-pub-3940256099942544/6300978111"

    fun interstitialId(): String {
        if (BuildConfig.DEBUG) {
            return "ca-app-pub-3940256099942544/1033173712"
        }
        return "ca-app-pub-0000000000000000/0000000000"
    }
}
