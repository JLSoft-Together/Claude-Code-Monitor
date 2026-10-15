import java.util.Locale

plugins {
    kotlin("jvm") version "2.3.0"
    id("com.gradleup.shadow") version "8.3.8"
}

val paparazziVersion = "2.0.0-alpha05.1"
// Must match the layoutlib version the Paparazzi release was compiled against (see its POM).
val layoutlibVersion = "16.2.3"

repositories {
    google()
    mavenCentral()
}

val osLabel: String = System.getProperty("os.name").lowercase(Locale.US).let { os ->
    when {
        os.startsWith("windows") -> "win"
        os.startsWith("mac") -> if (System.getProperty("os.arch").startsWith("x86")) "mac" else "mac-arm"
        else -> "linux"
    }
}

val layoutlibJar by configurations.creating { isTransitive = false }
val layoutlibRuntime by configurations.creating { isTransitive = false }
val layoutlibResources by configurations.creating { isTransitive = false }

// Pulled in by sdk-common/sdklib for SDK download, signing and analytics, never on the render path;
// dropping them halves the jar (analytics protos alone are 26 MB). Re-add one if a NoClassDefFoundError names it.
configurations.matching { it.name in setOf("runtimeClasspath", "testRuntimeClasspath") }.configureEach {
    exclude(group = "com.android.tools.analytics-library", module = "protos")
    exclude(group = "org.bouncycastle")
    exclude(group = "org.apache.httpcomponents")
    exclude(group = "com.google.jimfs")
}

dependencies {
    // layoutlib (57 MB) is downloaded by the app at runtime and put on -cp next to the daemon jar.
    implementation("app.cash.paparazzi:paparazzi:$paparazziVersion") {
        exclude(group = "com.android.tools.layoutlib", module = "layoutlib")
    }
    implementation("com.google.code.gson:gson:2.11.0")
    // Already pulled in at runtime by Paparazzi; compile access for the RecyclerView preview adapter.
    implementation("net.bytebuddy:byte-buddy:1.18.14")
    compileOnly("com.android.tools.layoutlib:layoutlib:$layoutlibVersion")
    layoutlibJar("com.android.tools.layoutlib:layoutlib:$layoutlibVersion")
    layoutlibRuntime("com.android.tools.layoutlib:layoutlib-runtime:$layoutlibVersion:$osLabel")
    layoutlibResources("com.android.tools.layoutlib:layoutlib-resources:$layoutlibVersion")

    testImplementation("com.android.tools.layoutlib:layoutlib:$layoutlibVersion")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

kotlin { jvmToolchain(21) }

// Fake project classes (custom views + R) for ProjectTest; kept off the test classpath so they load only
// through the project ClassLoader, like a real app.
val fixture: SourceSet by sourceSets.creating
dependencies { "fixtureCompileOnly"("com.android.tools.layoutlib:layoutlib:$layoutlibVersion") }

val layoutlibDist = layout.buildDirectory.dir("layoutlib-dist")

// Same folder shape the app produces under <dataDir>/layoutlib/<version>/ after download.
val stageLayoutlib by tasks.registering(Sync::class) {
    from(layoutlibJar)
    into(layoutlibDist)
    into("runtime") { from({ layoutlibRuntime.map { zipTree(it) } }) }
    into("resources") { from({ layoutlibResources.map { zipTree(it) } }) }
}

tasks.shadowJar {
    archiveFileName.set("layout-daemon.jar")
    mergeServiceFiles()
    exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/*.EC", "module-info.class")
    manifest { attributes("Main-Class" to "dev.ccm.layoutdaemon.MainKt") }
}

tasks.jar { enabled = false }
tasks.assemble { dependsOn(tasks.shadowJar, stageLayoutlib) }

tasks.test {
    dependsOn(stageLayoutlib, tasks.named("fixtureClasses"))
    systemProperty("fixture.classes", fixture.output.classesDirs.asPath)
    useJUnitPlatform()
    maxHeapSize = "1g"
    // layoutlib + Paparazzi keep JVM-wide static state; one JVM per test class.
    forkEvery = 1
    environment("CCM_PROJECT_MODEL", System.getenv("CCM_PROJECT_MODEL") ?: "")
    environment("CCM_PROJECT_LAYOUTS", System.getenv("CCM_PROJECT_LAYOUTS") ?: "")
    environment("CCM_GOLDEN_RECORD", System.getenv("CCM_GOLDEN_RECORD") ?: "")
    systemProperty("golden.dir", file("src/test/resources/golden").path)
    systemProperty("golden.out", layout.buildDirectory.dir("golden-out").get().asFile.path)
    jvmArgs("-XX:+EnableDynamicAgentLoading", "-Djdk.attach.allowAttachSelf=true")
    systemProperty("layoutlib.dir", layoutlibDist.get().asFile.path)
    testLogging { events("passed", "failed", "skipped"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

// Loose kit (PLAN-v44): library views for a layout XML outside any Gradle project; shipped next to the daemon jar.
val looseKit by configurations.creating
val looseKitDir = layout.buildDirectory.dir("loose-kit")
val looseKitTheme = "@style/Theme.Material3.DayNight.NoActionBar"
dependencies {
    looseKit("androidx.constraintlayout:constraintlayout:2.2.1")
    looseKit("androidx.appcompat:appcompat:1.6.1")
    looseKit("com.google.android.material:material:1.12.0")
}
// Never on the view render path: app start-up, background work, Kotlin (the daemon jar already carries a stdlib).
looseKit.exclude(group = "org.jetbrains.kotlin")
looseKit.exclude(group = "org.jetbrains.kotlinx")
looseKit.exclude(group = "org.jetbrains", module = "annotations")
looseKit.exclude(group = "com.google.errorprone")
looseKit.exclude(group = "com.google.guava")
listOf(
    "androidx.core" to "core-ktx", "androidx.profileinstaller" to "profileinstaller", "androidx.startup" to "startup-runtime",
    "androidx.lifecycle" to "lifecycle-process", "androidx.documentfile" to "documentfile", "androidx.print" to "print",
    "androidx.localbroadcastmanager" to "localbroadcastmanager", "androidx.legacy" to "legacy-support-core-utils",
    "androidx.concurrent" to "concurrent-futures", "androidx.tracing" to "tracing",
).forEach { (g, m) -> looseKit.exclude(group = g, module = m) }

val kitgen: SourceSet by sourceSets.creating
dependencies { "kitgenImplementation"("net.bytebuddy:byte-buddy:1.18.14") }

val stageLooseKitFiles by tasks.registering {
    inputs.files(looseKit)
    outputs.dir(looseKitDir)
    doLast {
        val out = looseKitDir.get().asFile
        out.deleteRecursively()
        looseKit.resolvedConfiguration.resolvedArtifacts.distinctBy { it.file }.forEach { a ->
            val id = a.moduleVersion.id
            val name = "${id.name}-${id.version}"
            if (a.file.name.endsWith(".aar")) {
                copy { from(zipTree(a.file)) { include("R.txt", "AndroidManifest.xml", "res/**") }; into(File(out, "aars/$name")) }
                copy { from(zipTree(a.file)) { include("classes.jar"); rename { "$name.jar" } }; into(File(out, "classes")) }
                copy { from(zipTree(a.file)) { include("libs/*.jar"); eachFile { path = "$name-${file.name}" }; includeEmptyDirs = false }; into(File(out, "classes")) }
            } else {
                copy { from(a.file); rename { "$name.jar" }; into(File(out, "classes")) }
            }
        }
    }
}

val stageLooseKit by tasks.registering(JavaExec::class) {
    dependsOn(stageLooseKitFiles)
    classpath = kitgen.runtimeClasspath
    mainClass.set("dev.ccm.layoutdaemon.kitgen.LooseKitGenKt")
    args(looseKitDir.get().asFile.path, "dev.ccm.loosekit", looseKitTheme, "constraintlayout 2.2.1, appcompat 1.6.1, material 1.12.0")
    outputs.file(looseKitDir.map { it.file("kit.json") })
}

tasks.assemble { dependsOn(stageLooseKit) }
tasks.test {
    dependsOn(stageLooseKit)
    systemProperty("loosekit.dir", looseKitDir.get().asFile.path)
}
