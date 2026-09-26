plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.reikatari.stormmultimedia"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.reikatari.stormmultimedia"
        minSdk = 24
        targetSdk = 36
        versionCode = 38
        versionName = "1.0.28"
    }

    signingConfigs {
        create("release") {
            val keystoreFile = project.findProperty("KEYSTORE_FILE") as String? ?: System.getenv("KEYSTORE_FILE")
            val keystorePassword = project.findProperty("KEYSTORE_PASSWORD") as String? ?: System.getenv("KEYSTORE_PASSWORD")
            val keyAliasName = project.findProperty("KEY_ALIAS") as String? ?: System.getenv("KEY_ALIAS") ?: "storm"
            val keyPasswordVal = project.findProperty("KEY_PASSWORD") as String? ?: System.getenv("KEY_PASSWORD")

            if (keystoreFile != null && keystorePassword != null) {
                storeFile = file(keystoreFile)
                storePassword = keystorePassword
                keyAlias = keyAliasName
                keyPassword = keyPasswordVal ?: keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = false
        aidl = false
        buildConfig = false
        shaders = false
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
}
