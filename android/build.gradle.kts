// VK Ads SDK resolves kotlin-stdlib 2.2.0; compile with matching Kotlin 2.2.
// Gradle 8.11.1 and Android Gradle Plugin 8.9.2 remain unchanged.
plugins {
    id("com.android.application") version "8.9.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.0" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.0" apply false
    id("vkid.manifest.placeholders") version "1.1.0" apply true
}

/*
 * VK ID for ECHO only (not Cat Fighting). Never commit the VK ID client secret.
 * Place ECHO_VK_CLIENT_SECRET in ~/.gradle/gradle.properties or the environment.
 * A benign placeholder keeps offline UI/debug builds possible before VK is set up.
 */
val echoVkSecret = System.getenv("ECHO_VK_CLIENT_SECRET")
    ?: providers.gradleProperty("ECHO_VK_CLIENT_SECRET").orNull
    ?: ""

vkidManifestPlaceholders {
    init(
        clientId = "54853387",
        clientSecret = echoVkSecret.ifBlank { "ECHO_VK_ID_NOT_CONFIGURED" }
    )
}
