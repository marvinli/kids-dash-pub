package dev.kidsdash.frame;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

public final class ArtLibraryTest {
    private static int passed;

    public static void main(String[] args) throws IOException {
        String a = repeat('a');
        String b = repeat('b');
        Map<String, String> remote = ArtLibrary.parseManifest(
                a + " bg-space.webp\n"
                        + b + " bg-space-blur.webp\n"
                        + "junk line\n"
                        + "XYZ bg-bad.webp\n"
                        + a + " ../escape.webp\n"
                        + b + " bg-space-copy.webp\n");
        check("keeps well-formed lines only", remote.size() == 3
                && a.equals(remote.get("bg-space.webp")) && b.equals(remote.get("bg-space-blur.webp")));
        check("no manifest, no paintings", ArtLibrary.parseManifest(null).isEmpty());

        File dir = Files.createTempDirectory("art").toFile();
        ArtLibrary art = new ArtLibrary(Arrays.asList("bg-fall.webp", "stk-bus.webp"), remote, dir);
        check("everything missing at first, each hash once", art.missing().equals(Arrays.asList(a, b)));
        check("the app's own art is ready",
                art.readyJson().equals("[\"bg-fall.webp\",\"stk-bus.webp\"]"));
        check("nothing downloaded to serve", art.downloaded("bg-space.webp") == null);

        write(new File(dir, a));
        write(new File(dir, b + ".part"));
        write(new File(dir, repeat('c')));
        art.prune();
        List<String> left = Arrays.asList(dir.list());
        check("prune keeps listed files and downloads in progress",
                left.size() == 2 && left.contains(a) && left.contains(b + ".part"));
        check("only what is still missing", art.missing().equals(Arrays.asList(b)));
        check("serves a downloaded painting by name",
                new File(dir, a).equals(art.downloaded("bg-space.webp")));
        check("not one only half here", art.downloaded("bg-space-blur.webp") == null);
        check("not an unlisted name", art.downloaded("bg-other.webp") == null);
        check("ready lists the downloaded file",
                art.readyJson().equals("[\"bg-fall.webp\",\"bg-space.webp\",\"stk-bus.webp\"]"));

        System.out.println("ArtLibraryTest: " + passed + " passed");
    }

    private static String repeat(char c) {
        char[] chars = new char[64];
        Arrays.fill(chars, c);
        return new String(chars);
    }

    private static void write(File f) throws IOException {
        Files.write(f.toPath(), new byte[] {1});
    }

    private static void check(String what, boolean ok) {
        if (!ok) throw new AssertionError(what);
        passed++;
    }
}
