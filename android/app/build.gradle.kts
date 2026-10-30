plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ID проекта RuStore Push «Prod» (RuStore Консоль → Инструменты → Push-уведомления). Не секрет:
// он вшит в приложение. Можно переопределить: -PrustorePushProjectId=... или переменной окружения.
val rustorePushProjectId: String =
    listOf(findProperty("rustorePushProjectId") as String?, System.getenv("RUSTORE_PUSH_PROJECT_ID"))
        .firstOrNull { !it.isNullOrBlank() }
        ?: "pjcddfMOCsqTfeARO0lbY7fCVFj4dJww"

android {
    namespace = "ru.semeinidispetcher.app"
    compileSdk = 35

    defaultConfig {
        // Тот же пакет, что у прежней сборки: обновление поверх, тот же ключ подписи
        applicationId = "ru.semeinidispetcher.app"
        minSdk = 26 // Android 8.0 — минимальная версия по правилам RuStore (п. 8.1)
        targetSdk = 35
        versionCode = 4
        versionName = "1.1.0"

        buildConfigField("String", "BASE_URL", "\"https://xn--d1ababaqfaymzobir4fyc.xn--p1ai\"")
        buildConfigField("String", "SITE_HOST", "\"xn--d1ababaqfaymzobir4fyc.xn--p1ai\"")
        buildConfigField("String", "RUSTORE_PUSH_PROJECT_ID", "\"$rustorePushProjectId\"")
    }

    buildTypes {
        release {
            // Подписываем после сборки тем же ключом, что и прежние версии (вне репозитория)
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("ru.rustore.sdk:pushclient:7.5.0")
}
