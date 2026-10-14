package dev.ccm.layoutdaemon

import android.animation.AnimationHandler
import android.graphics.Bitmap
import android.os.Looper_Accessor
import android.util.DisplayMetrics
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.PaparazziSdk
import com.android.ide.common.rendering.api.AssetRepository
import com.android.ide.common.rendering.api.ILayoutLog
import com.android.ide.common.rendering.api.LayoutlibCallback
import com.android.ide.common.rendering.api.RenderSession
import com.android.ide.common.rendering.api.ResourceNamespace
import com.android.ide.common.rendering.api.ResourceReference
import com.android.ide.common.rendering.api.Result
import com.android.ide.common.rendering.api.SessionParams
import com.android.ide.common.resources.ResourceRepository
import com.android.ide.common.resources.getConfiguredResources
import com.android.layoutlib.bridge.Bridge
import com.android.layoutlib.bridge.impl.RenderSessionImpl
import com.android.resources.LayoutDirection
import com.android.resources.ResourceType

/**
 * Rebuilds PaparazziSdk's render session with our own [LayoutlibCallback] and project resources.
 * Paparazzi's builder hard-wires its callback (Class.forName in the daemon loader) and the project
 * resources it read at first `prepare()`; this mirrors `unsafeUpdateConfig` + `SessionParamsBuilder.build`
 * minus pseudolocales. Everything Paparazzi-private is reached by reflection here and nowhere else.
 */
class SessionSwapper(private val sdk: PaparazziSdk) {
    private val builder: Any = PaparazziInternals.sessionParamsBuilder()
    private val frameworkResources = builderField("frameworkResources") as ResourceRepository
    val emptyProjectResources = builderField("projectResources") as ResourceRepository
    private val assets = builderField("assetRepository") as AssetRepository
    private val logger = builderField("logger") as ILayoutLog

    @Suppress("UNCHECKED_CAST")
    private val flags = builderField("flags") as Map<SessionParams.Key<Any>, Any>

    fun swap(
        device: DeviceConfig,
        theme: String,
        projectResources: ResourceRepository,
        callback: LayoutlibCallback,
        minSdk: Int,
        targetSdk: Int,
    ) {
        val params = build(device, theme, projectResources, callback, minSdk, targetSdk)
        runCatching { sdkField<RenderSessionImpl>("renderSession")?.release() }
        runCatching { sdkField<RenderSession>("bridgeRenderSession")?.dispose() }
        Looper_Accessor.cleanupThread()

        val session = RenderSessionImpl(params)
        session.setElapsedFrameTimeNanos(0L)
        val init = session.init(params.timeout)
        Bitmap.setDefaultDensity(DisplayMetrics.DENSITY_DEVICE_STABLE)
        if (!init.isSuccess) {
            runCatching { session.release() }
            error("session init failed: ${init.errorMessage ?: init.status}")
        }
        val inflated = session.inflate()
        val ctor = Class.forName("com.android.layoutlib.bridge.BridgeRenderSession")
            .getDeclaredConstructor(RenderSessionImpl::class.java, Result::class.java)
        ctor.isAccessible = true
        setSdkField("renderSession", session)
        setSdkField("bridgeRenderSession", ctor.newInstance(session, inflated))
        AnimationHandler.sAnimatorHandler.set(null)
        if (!inflated.isSuccess) error("session inflate failed: ${inflated.errorMessage ?: inflated.status}")
    }

    private fun build(
        device: DeviceConfig,
        theme: String,
        projectResources: ResourceRepository,
        callback: LayoutlibCallback,
        minSdk: Int,
        targetSdk: Int,
    ): SessionParams {
        val framework = theme.startsWith("android:")
        val themeName = if (framework) theme.removePrefix("android:") else theme
        val folder = device.folderConfiguration
        val resources = HashMap<ResourceNamespace, Map<ResourceType, com.android.ide.common.resources.ResourceValueMap>>()
        resources[ResourceNamespace.ANDROID] = frameworkResources.getConfiguredResources(folder).row(ResourceNamespace.ANDROID)
        projectResources.getConfiguredResources(folder).rowMap().forEach { (ns, map) -> resources[ns] = map }
        val resolver = com.android.ide.common.resources.ResourceResolver.create(
            resources,
            ResourceReference(if (framework) ResourceNamespace.ANDROID else ResourceNamespace.RES_AUTO, ResourceType.STYLE, themeName),
        )
        val params = SessionParams(
            PaparazziInternals.parserFromString(CONTENT_ROOT),
            SessionParams.RenderingMode.NORMAL,
            null,
            device.hardwareConfig,
            resolver,
            callback,
            minSdk,
            targetSdk,
            logger,
        )
        params.fontScale = device.fontScale
        params.uiMode = device.uiModeMask
        val locale = folder.localeQualifier
        params.locale = if (folder.layoutDirectionQualifier.value == LayoutDirection.RTL && !Bridge.isLocaleRtl(locale.tag)) "ur" else locale.tag
        params.setRtlSupport(true)
        flags.forEach { (k, v) -> params.setFlag(k, v) }
        params.setAssetRepository(assets)
        params.setForceNoDecor()
        return params
    }

    private fun builderField(name: String): Any? =
        builder.javaClass.getDeclaredField(name).apply { isAccessible = true }.get(builder)

    @Suppress("UNCHECKED_CAST")
    private fun <T> sdkField(name: String): T? =
        PaparazziSdk::class.java.getDeclaredField(name).apply { isAccessible = true }.let { f ->
            runCatching { f.get(sdk) as T? }.getOrNull()
        }

    private fun setSdkField(name: String, value: Any) {
        PaparazziSdk::class.java.getDeclaredField(name).apply { isAccessible = true }.set(sdk, value)
    }

    private companion object {
        // PaparazziSdk.contentRoot(NORMAL) without Compose on the classpath.
        const val CONTENT_ROOT = """<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent"/>"""
    }
}
