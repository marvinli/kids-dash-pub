package dev.kidsdash.frame;

import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

/**
 * The page's art: what the app carries (assets/web/art) plus the backdrop
 * paintings it downloads after installing. Over 30 MB of paintings made app
 * updates too big for this frame's Wi-Fi, so frame-web's build leaves all but
 * the four season originals out and lists them in art-remote.txt as
 * `<sha256> <name>` lines. They download by hash (GET /v1/art/{sha256}) into
 * one directory as `<sha256>`, and the page is served `art/<name>` from there
 * when the app does not have it. Pure apart from listing that directory.
 */
final class ArtLibrary {
    static final String MANIFEST_ASSET = "web/art-remote.txt";
    /** ApiClient.PART_SUFFIX: a download in progress (ApiClient is not on the test classpath). */
    static final String PART_SUFFIX = ".part";

    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]*\\.webp");

    private final Set<String> inApp;
    /** File name to sha256, in the manifest's order. */
    private final Map<String, String> remote;
    private final File dir;

    ArtLibrary(Collection<String> inApp, Map<String, String> remote, File dir) {
        this.inApp = Collections.unmodifiableSet(new HashSet<>(inApp));
        this.remote = Collections.unmodifiableMap(new LinkedHashMap<>(remote));
        this.dir = dir;
    }

    /** `<sha256> <name>` lines; anything else is skipped. */
    static Map<String, String> parseManifest(String text) {
        Map<String, String> files = new LinkedHashMap<>();
        if (text == null) return files;
        for (String line : text.split("\n")) {
            String[] parts = line.trim().split(" ");
            if (parts.length != 2) continue;
            if (!SHA256.matcher(parts[0]).matches() || !NAME.matcher(parts[1]).matches()) continue;
            files.put(parts[1], parts[0]);
        }
        return files;
    }

    File dir() {
        return dir;
    }

    /** The downloaded copy of `name` if it is a listed painting and here, else null. */
    File downloaded(String name) {
        String sha = remote.get(name);
        if (sha == null) return null;
        File file = new File(dir, sha);
        return file.isFile() ? file : null;
    }

    /** Hashes still to download, in the manifest's order (one painting's files together). */
    List<String> missing() {
        List<String> missing = new ArrayList<>();
        for (String sha : new LinkedHashSet<>(remote.values())) {
            if (!new File(dir, sha).isFile()) missing.add(sha);
        }
        return missing;
    }

    /** Whether a file in the directory belongs: a listed hash, or its download in progress. */
    boolean keeps(String fileName) {
        String sha = fileName.endsWith(PART_SUFFIX)
                ? fileName.substring(0, fileName.length() - PART_SUFFIX.length())
                : fileName;
        return remote.containsValue(sha);
    }

    /** Removes what an older build listed and this one does not. */
    void prune() {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            //noinspection ResultOfMethodCallIgnored
            if (!keeps(f.getName())) f.delete();
        }
    }

    /** The names the page can load now, as a JSON array (names are plain, so no escaping). */
    String readyJson() {
        Set<String> ready = new TreeSet<>(inApp);
        for (Map.Entry<String, String> e : remote.entrySet()) {
            if (new File(dir, e.getValue()).isFile()) ready.add(e.getKey());
        }
        StringBuilder json = new StringBuilder("[");
        for (String name : ready) {
            if (!NAME.matcher(name).matches()) continue;
            if (json.length() > 1) json.append(',');
            json.append('"').append(name).append('"');
        }
        return json.append(']').toString();
    }
}
