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
    jvmArgs("-XX:+EnableDynamicAgentLoading", "-Djdk.attach.allowAttachSelf=true")
    systemProperty("layoutlib.dir", layoutlibDist.get().asFile.path)
    testLogging { events("passed", "failed", "skipped"); showStandardStreams = false; exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
