package dev.ccm.layoutdaemon;

import app.cash.paparazzi.PaparazziSdk;
import app.cash.paparazzi.internal.parsers.LayoutPullParser;
import app.cash.paparazzi.internal.parsers.TagSnapshot;
import app.cash.paparazzi.internal.resources.AarSourceResourceRepository;
import app.cash.paparazzi.internal.resources.AppResourceRepository;
import com.android.ide.common.rendering.api.ILayoutPullParser;
import com.android.ide.common.resources.ResourceRepository;
import java.io.File;
import java.io.FileNotFoundException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Paparazzi's resource repositories and parsers are Kotlin {@code internal}; Kotlin callers cannot
 * name them, Java can. Only public sdk-common / layoutlib types leak out of this class.
 */
public final class PaparazziInternals {
    private PaparazziInternals() {}

    public static ResourceRepository aarRepository(Path resDir, String libraryName) {
        return AarSourceResourceRepository.Companion.create(resDir, libraryName);
    }

    public static ResourceRepository appRepository(List<File> localResDirs, Collection<ResourceRepository> aarRepositories) {
        List<AarSourceResourceRepository> aars = new ArrayList<>(aarRepositories.size());
        for (ResourceRepository repo : aarRepositories) aars.add((AarSourceResourceRepository) repo);
        return AppResourceRepository.Companion.create(localResDirs, List.of(), aars);
    }

    /** PaparazziSdk's static SessionParamsBuilder (framework resources, assets, logger, flags). */
    public static Object sessionParamsBuilder() {
        return PaparazziSdk.Companion.getSessionParamsBuilder$paparazzi();
    }

    public static ILayoutPullParser parserFromString(String xml) {
        return LayoutPullParser.Companion.createFromString(xml);
    }

    /** {@code aaptOut} receives the file's inline {@code <aapt:attr>} subtrees, keyed by their {@code @aapt:_aapt/…} value. */
    public static ILayoutPullParser parserFromFile(File file, Map<String, Object> aaptOut) throws FileNotFoundException {
        LayoutPullParser parser = LayoutPullParser.Companion.createFromFile(file);
        aaptOut.putAll(parser.getAaptDeclaredAttrs());
        return parser;
    }

    public static ILayoutPullParser parserFromAapt(Object tag, Map<String, Object> aaptOut) {
        LayoutPullParser parser = LayoutPullParser.Companion.createFromAaptResource((TagSnapshot) tag);
        aaptOut.putAll(parser.getAaptDeclaredAttrs());
        return parser;
    }
}
