package dev.kidsdash.frame;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** The device API over HttpsURLConnection. Blocking: call from the worker thread. */
final class ApiClient {
    static final class BundleResponse {
        final int status;
        final String etag;
        final String body;

        BundleResponse(int status, String etag, String body) {
            this.status = status;
            this.etag = etag;
            this.body = body;
        }
    }

    static final class HttpException extends IOException {
        final int status;

        HttpException(int status, String what) {
            super(what + " answered " + status);
            this.status = status;
        }
    }

    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 20_000;
    private static final int MAX_PHOTO_BYTES = 4 * 1024 * 1024;
    /** Server caps videos at 80 MB; a little headroom, never unbounded. */
    static final long MAX_SLIDE_BYTES = 90L * 1024 * 1024;
    private static final int SLIDE_READ_TIMEOUT_MS = 60_000;

    /** An app update; real builds are a few MB. */
    static final long MAX_APP_BYTES = 60L * 1024 * 1024;
    /** The biggest painting is under 600 KB. */
    static final long MAX_ART_BYTES = 4L * 1024 * 1024;

    private final String baseUrl;
    private final String token;
    /** Sent with each poll so the server knows which build every frame runs. */
    private final int appVersion;

    ApiClient(String baseUrl, String token, int appVersion) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.appVersion = appVersion;
    }

    /** GET /v1/bundle; 304 when `etag` still matches. */
    BundleResponse fetchBundle(String etag) throws IOException {
        HttpURLConnection c = open("/v1/bundle", "GET");
        if (etag != null) c.setRequestProperty("If-None-Match", etag);
        c.setRequestProperty("X-Frame-Version", String.valueOf(appVersion));
        try {
            int status = c.getResponseCode();
            if (status == 304) return new BundleResponse(304, etag, null);
            if (status != 200) throw new HttpException(status, "bundle");
            return new BundleResponse(200, c.getHeaderField("ETag"), readString(c.getInputStream()));
        } finally {
            c.disconnect();
        }
    }

    /** PUT /v1/chores/{kid}/{chore}. */
    void setChore(String kidId, String choreId, String date, boolean done) throws IOException {
        HttpURLConnection c = open("/v1/chores/" + enc(kidId) + "/" + enc(choreId), "PUT");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        byte[] body = ("{\"date\":\"" + date + "\",\"done\":" + done + "}").getBytes(StandardCharsets.UTF_8);
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        try {
            int status = c.getResponseCode();
            if (status != 204) throw new HttpException(status, "chore");
        } finally {
            c.disconnect();
        }
    }

    /**
     * POST /v1/events: an event someone added on the frame (the page's JSON,
     * checked by the server). Returns the new event's id.
     */
    String addEvent(String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > 4096) throw new IOException("Event too large");
        HttpURLConnection c = open("/v1/events", "POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        try {
            int status = c.getResponseCode();
            if (status != 201) throw new HttpException(status, "event");
            return new org.json.JSONObject(readString(c.getInputStream())).getJSONObject("event").getString("id");
        } catch (org.json.JSONException e) {
            throw new IOException("Bad event response", e);
        } finally {
            c.disconnect();
        }
    }

    /**
     * PUT /v1/events/{id}: an event someone edited on the frame (the page's
     * JSON, checked by the server). `eventId` is the bundle id (`g-…`).
     */
    void editEvent(String eventId, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > 4096) throw new IOException("Event too large");
        HttpURLConnection c = open("/v1/events/" + enc(eventId), "PUT");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        try {
            int status = c.getResponseCode();
            if (status != 200) throw new HttpException(status, "event edit");
        } finally {
            c.disconnect();
        }
    }

    /**
     * DELETE /v1/events/{id}?scope=one|all: an event someone deleted on the
     * frame. `eventId` is the bundle id (`g-…`); "all" deletes a repeating
     * event's whole series. (A query, not a body: DELETE bodies are unreliable
     * on Android's HttpURLConnection.)
     */
    void deleteEvent(String eventId, String scope) throws IOException {
        String which = "all".equals(scope) ? "all" : "one";
        HttpURLConnection c = open("/v1/events/" + enc(eventId) + "?scope=" + which, "DELETE");
        try {
            int status = c.getResponseCode();
            if (status != 204) throw new HttpException(status, "event delete");
        } finally {
            c.disconnect();
        }
    }

    /**
     * POST /v1/chores: a chore someone added on the frame (the page's JSON,
     * checked by the server). Returns the saved chore as JSON.
     */
    String addChore(String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > 4096) throw new IOException("Chore too large");
        HttpURLConnection c = open("/v1/chores", "POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        try {
            int status = c.getResponseCode();
            if (status != 201) throw new HttpException(status, "chore");
            return new org.json.JSONObject(readString(c.getInputStream())).getJSONObject("chore").toString();
        } catch (org.json.JSONException e) {
            throw new IOException("Bad chore response", e);
        } finally {
            c.disconnect();
        }
    }

    /** POST /v1/incidents: an outage report (JSON per core FrameIncidentInput). */
    void reportIncident(String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        if (body.length > 128 * 1024) throw new IOException("Report too large");
        HttpURLConnection c = open("/v1/incidents", "POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        try (OutputStream out = c.getOutputStream()) {
            out.write(body);
        }
        try {
            int status = c.getResponseCode();
            if (status != 201) throw new HttpException(status, "incident");
        } finally {
            c.disconnect();
        }
    }

    /** GET /v1/photos/{kid}. */
    byte[] fetchPhoto(String kidId) throws IOException {
        HttpURLConnection s3 = openRedirect("/v1/photos/" + enc(kidId), "photo", READ_TIMEOUT_MS, null);
        try {
            return readBytes(s3.getInputStream(), MAX_PHOTO_BYTES);
        } finally {
            s3.disconnect();
        }
    }

    /**
     * GET /v1/slides/{sha256}, paced and resumable like an app update (a
     * video runs to tens of MB, and pulling one flat out drops this frame's
     * Wi-Fi): `<target>.part` keeps what arrived, and only a whole file whose
     * sha256 matches takes the real name.
     */
    void fetchSlide(String sha256, File target) throws IOException {
        File part = new File(target.getPath() + PART_SUFFIX);
        fetchResumable("/v1/slides/" + enc(sha256), "slide", sha256, MAX_SLIDE_BYTES, part, target);
    }

    /** GET /v1/art/{sha256}: a backdrop painting (ArtLibrary), paced and resumable like a slide. */
    void fetchArt(String sha256, File target) throws IOException {
        File part = new File(target.getPath() + PART_SUFFIX);
        fetchResumable("/v1/art/" + enc(sha256), "art", sha256, MAX_ART_BYTES, part, target);
    }

    /** A slide's download in progress, next to it in slides/. */
    static final String PART_SUFFIX = ".part";

    /** A download cut short (the network went away): what arrived is kept for next time. */
    static final class DownloadInterrupted extends IOException {
        DownloadInterrupted(long have, Throwable cause) {
            super("interrupted at " + have / 1024 + " KB: " + cause.getMessage(), cause);
        }
    }

    /**
     * GET /v1/app/{sha256}: an app update, paced (UpdatePolicy) and resumable.
     * `part` holds what has arrived; a cut connection throws DownloadInterrupted
     * and keeps it, and the next call asks for the rest. Once whole, the file
     * is checked against the hash and only then takes `target`'s name.
     */
    void fetchApp(String sha256, File part, File target) throws IOException {
        fetchResumable("/v1/app/" + enc(sha256), "app", sha256, MAX_APP_BYTES, part, target);
    }

    private void fetchResumable(String path, String what, String sha256, long maxBytes, File part, File target)
            throws IOException {
        long have = part.exists() ? part.length() : 0;
        if (have > maxBytes) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            have = 0;
        }
        HttpURLConnection s3;
        long from;
        try {
            s3 = openRedirect(path, what, SLIDE_READ_TIMEOUT_MS, UpdatePolicy.rangeHeader(have));
            from = UpdatePolicy.writeFrom(s3.getResponseCode(), have);
        } catch (HttpException e) {
            // 416: nothing left to send, so what we have is the whole file. Any
            // other answer is a real refusal.
            if (e.status != 416 || have == 0) throw e;
            s3 = null;
            from = have;
        } catch (IOException e) {
            throw new DownloadInterrupted(have, e);
        }
        if (s3 != null) readInto(s3, part, from, maxBytes, what);
        if (!sha256.equals(sha256Of(part))) {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
            throw new IOException(what + " hash mismatch");
        }
        if (!part.renameTo(target)) throw new IOException("Could not store " + what);
    }

    /** Streams `s3` into `part` from `from`, paced; a cut connection keeps what arrived. */
    private static void readInto(HttpURLConnection s3, File part, long from, long maxBytes, String what)
            throws IOException {
        long written = from;
        try (InputStream in = s3.getInputStream();
                FileOutputStream out = new FileOutputStream(part, from > 0)) {
            byte[] buffer = new byte[64 * 1024];
            long start = System.currentTimeMillis();
            long read = 0;
            int n;
            while (true) {
                try {
                    n = in.read(buffer);
                } catch (IOException e) {
                    out.getFD().sync();
                    throw new DownloadInterrupted(written, e);
                }
                if (n == -1) break;
                written += n;
                read += n;
                if (written > maxBytes) {
                    //noinspection ResultOfMethodCallIgnored
                    part.delete();
                    throw new IOException(what + " too large");
                }
                out.write(buffer, 0, n);
                long pause = UpdatePolicy.pauseMs(read, System.currentTimeMillis() - start,
                        UpdatePolicy.DOWNLOAD_BYTES_PER_S);
                if (pause > 0) {
                    try {
                        Thread.sleep(pause);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        out.getFD().sync();
                        throw new DownloadInterrupted(written, e);
                    }
                }
            }
            out.getFD().sync();
        } finally {
            s3.disconnect();
        }
    }

    private static String sha256Of(File file) throws IOException {
        try (InputStream in = new java.io.FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) digest.update(buffer, 0, n);
            return BundleVerifier.hex(digest.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }

    /**
     * Device routes for stored files answer 302 to a short-lived S3 URL. The
     * redirect is followed by hand so the device token is never sent to S3.
     */
    private HttpURLConnection openRedirect(String path, String what, int readTimeoutMs, String range)
            throws IOException {
        HttpURLConnection c = open(path, "GET");
        c.setInstanceFollowRedirects(false);
        String location;
        try {
            int status = c.getResponseCode();
            if (status != 302) throw new HttpException(status, what);
            location = c.getHeaderField("Location");
        } finally {
            c.disconnect();
        }
        if (location == null || !location.startsWith("https://")) throw new IOException("Bad " + what + " redirect");
        HttpURLConnection s3 = (HttpURLConnection) new URL(location).openConnection();
        s3.setConnectTimeout(CONNECT_TIMEOUT_MS);
        s3.setReadTimeout(readTimeoutMs);
        s3.setInstanceFollowRedirects(false);
        // A presigned GET honours Range; the signature does not cover it.
        if (range != null) s3.setRequestProperty("Range", range);
        int status = s3.getResponseCode();
        if (status != 200 && !(range != null && status == 206)) {
            s3.disconnect();
            throw new HttpException(status, what + " download");
        }
        return s3;
    }

    private HttpURLConnection open(String path, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(baseUrl + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setUseCaches(false);
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("Accept", "application/json");
        return c;
    }

    private static String enc(String value) throws IOException {
        return URLEncoder.encode(value, "UTF-8");
    }

    private static String readString(InputStream in) throws IOException {
        return new String(readBytes(in, 2 * 1024 * 1024), StandardCharsets.UTF_8);
    }

    private static byte[] readBytes(InputStream in, int limit) throws IOException {
        try (InputStream input = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            int n;
            while ((n = input.read(buffer)) != -1) {
                out.write(buffer, 0, n);
                if (out.size() > limit) throw new IOException("Response too large");
            }
            return out.toByteArray();
        }
    }
}
