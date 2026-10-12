import groovy.json.JsonSlurper
import java.security.MessageDigest

plugins { id("com.android.application") }
val runtimeAssets = providers.gradleProperty("unifiedRuntimeAssetsDir")
    .map { rootProject.file(it) }.getOrElse(rootProject.file("runtime-assets"))
android {
    namespace = "com.eleckoi.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.eleckoi.app"
        minSdk = 27
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.9"
        ndk { abiFilters += "arm64-v8a" }
    }
    sourceSets.getByName("main").assets.directories += runtimeAssets.absolutePath
    androidResources { noCompress += "archive" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { useLegacyPackaging = true } }
    buildTypes { getByName("release") { isMinifyEnabled = false } }
}
dependencies {
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

val verifyRuntimeAssets = tasks.register("verifyRuntimeAssets") {
    group = "verification"
    inputs.dir(runtimeAssets)
    doLast {
        val manifestFile = runtimeAssets.resolve("runtime/manifest.json")
        check(manifestFile.isFile) { "Missing unified Host assets: $manifestFile. Stage ARM64 rootfs, Node and real Host before acceptance." }
        val manifest = JsonSlurper().parse(manifestFile) as Map<*, *>
        check(manifest["schemaVersion"] == 1 && manifest["architecture"] == "arm64-v8a" && manifest["protocolVersion"] == 1
            && manifest["nodeExecutable"] == "/usr/bin/node" && manifest["hostEntrypoint"] == "/eleckoi/app/bin/eleckoi-host.mjs") { "Unsupported runtime manifest" }
        val archives = manifest["archives"] as? List<*> ?: error("Runtime archives missing")
        val expected = listOf("runtime/rootfs.archive" to "rootfs", "runtime/node.archive" to "rootfs",
            "runtime/git.archive" to "rootfs", "runtime/app.archive" to "app")
        check(archives.size == expected.size) { "Runtime requires rootfs, Node, Git and Host archives" }
        archives.forEachIndexed { index, value ->
            val archive = value as Map<*, *>
            val asset = archive["asset"] as? String ?: error("Archive asset missing")
            check(asset == expected[index].first && archive["target"] == expected[index].second) { "Unexpected runtime archive: $asset" }
            val file = runtimeAssets.resolve(asset).canonicalFile
            check(file.toPath().startsWith(runtimeAssets.canonicalFile.toPath()) && file.isFile) { "Missing archive $asset" }
            val digest = archive["sha256"] as? String ?: error("Missing SHA-256 for $asset")
            check(digest.matches(Regex("[a-f0-9]{64}"))) { "Invalid SHA-256 for $asset" }
            check((archive["bytes"] as? Number)?.toLong() == file.length()) { "Runtime size mismatch: $asset" }
            check((archive["unpackedBytes"] as? Number)?.toLong()?.let { it > 0 } == true) { "Missing unpacked runtime size: $asset" }
            val sha256 = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; sha256.update(buffer, 0, count) }
            }
            check(sha256.digest().joinToString("") { "%02x".format(it) } == digest) { "Runtime checksum mismatch: $asset" }
        }
    }
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(verifyRuntimeAssets)
}

afterEvaluate {
    listOf("Debug", "Release").forEach { variant ->
        val outputDirectory = layout.buildDirectory.dir("outputs/apk/${variant.lowercase()}")
        val descriptor = tasks.register<Exec>("write${variant}UpdateDescriptor") {
            dependsOn("package$variant")
            inputs.file(outputDirectory.map { it.file("output-metadata.json") })
            outputs.file(outputDirectory.map { it.file("android-update.json") })
            outputs.upToDateWhen { false }
            commandLine("node", rootProject.file("../../scripts/android-runtime/create-update-descriptor.mjs"),
                outputDirectory.get().file("output-metadata.json").asFile, outputDirectory.get().file("android-update.json").asFile)
        }
        tasks.named("assemble$variant").configure { finalizedBy(descriptor) }
    }
}
