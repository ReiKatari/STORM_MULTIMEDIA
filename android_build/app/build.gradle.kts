import java.util.Properties

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
        versionCode = 52
        versionName = "1.0.43"
    }

    val stormSigningProps = Properties().apply {
        val centralProps = file("F:/STORM ALL PROJECTS/.storm-secrets/storm_signing.properties")
        val envProps = System.getenv("STORM_SIGNING_PROPS")?.let { file(it) }
        val activePropsFile = listOfNotNull(envProps, centralProps).firstOrNull { it.exists() }
        if (activePropsFile != null) {
            activePropsFile.inputStream().use { load(it) }
        }
    }
    val unifiedCertFile = (
        System.getenv("STORM_CERT_FILE")
            ?: stormSigningProps.getProperty("STORM_CERT_FILE")
        )?.let { file(it) }?.takeIf { it.exists() }
    val unifiedCertPassword = System.getenv("STORM_CERT_PASSWORD")
        ?: stormSigningProps.getProperty("STORM_CERT_PASSWORD")
        ?: ""
    val unifiedKeyAlias = System.getenv("STORM_KEY_ALIAS")
        ?: stormSigningProps.getProperty("STORM_KEY_ALIAS")
        ?: ""
    val unifiedKeyPassword = System.getenv("STORM_KEY_PASSWORD")
        ?: stormSigningProps.getProperty("STORM_KEY_PASSWORD")
        ?: ""

    signingConfigs {
        create("release") {
            if (unifiedCertFile != null) {
                storeFile = unifiedCertFile
                storePassword = unifiedCertPassword
                keyAlias = unifiedKeyAlias
                keyPassword = unifiedKeyPassword
            }
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
        getByName("debug") {
            if (unifiedCertFile != null) {
                storeFile = unifiedCertFile
                storePassword = unifiedCertPassword
                keyAlias = unifiedKeyAlias
                keyPassword = unifiedKeyPassword
            }
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
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
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
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
    jvmToolchain(21)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
}
