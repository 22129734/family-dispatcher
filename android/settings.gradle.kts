// Android-приложение «Семейный диспетчер» для RuStore: нативная оболочка вокруг веб-версии
// с push RuStore, офлайн-экраном, «Поделиться» и голосовым вводом (п. 8.2 правил RuStore).
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // RuStore Push SDK
        maven { url = uri("https://nexus-external.rustore.ru/repository/maven-rustore-exposed/") }
    }
}

rootProject.name = "family-dispatcher-android"
include(":app")
