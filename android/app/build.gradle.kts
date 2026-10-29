plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("vkid.manifest.placeholders")
}

// The release signing key and all passwords are provided only by the
// developer's workstation or short-lived GitHub Actions environment.
// NEVER add a production keystore/password to this repository.
val releaseKeyPath = System.getenv("ECHO_RELEASE_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
val releaseStorePassword = System.getenv("ECHO_RELEASE_STORE_PASSWORD")?.takeIf { it.isNotBlank() }
val releaseKeyAlias = System.getenv("ECHO_RELEASE_KEY_ALIAS")?.takeIf { it.isNotBlank() }
val releaseKeyPassword = System.getenv("ECHO_RELEASE_KEY_PASSWORD")?.takeIf { it.isNotBlank() }
val releaseSigningReady = releaseKeyPath != null && releaseStorePassword != null &&
    releaseKeyAlias != null && releaseKeyPassword != null

android {
    namespace = "ru.echo.game"
    compileSdk = 35

    defaultConfig {
        applicationId = "ru.echogame.arena"
        minSdk = 26
        targetSdk = 35
        versionCode = 20
        versionName = "1.0.1"

        val vkConfigured = !((System.getenv("ECHO_VK_CLIENT_SECRET")
            ?: providers.gradleProperty("ECHO_VK_CLIENT_SECRET").orNull).isNullOrBlank())
        buildConfigField("boolean", "ECHO_VK_CONFIGURED", vkConfigured.toString())
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    signingConfigs {
        if (releaseSigningReady) {
            create("echoRuStoreRelease") {
                storeFile = file(releaseKeyPath!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = false
            if (releaseSigningReady) {
                signingConfig = signingConfigs.getByName("echoRuStoreRelease")
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.vk.id:vkid:2.7.3")
    // Native VK Ads rewarded video for standalone APK, placement 2096987.
    implementation("com.my.target:mytarget-sdk:5.52.5")

    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")

    debugImplementation("androidx.compose.ui:ui-tooling")
}
