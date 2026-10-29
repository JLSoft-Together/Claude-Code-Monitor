plugins {
    alias(libs.plugins.android.application)
    id("com.google.gms.google-services")
}

android {
    namespace = "com.example.shop"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.shop"
        minSdk = 24
        targetSdk = 33
        versionCode = 7
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = true
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

dependencies {
    implementation(libs.play.services.ads)
    implementation(libs.billing)
}
