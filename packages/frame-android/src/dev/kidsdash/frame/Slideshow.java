package dev.kidsdash.frame;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.PointF;
import android.graphics.PorterDuff;
import android.graphics.Typeface;
import android.media.FaceDetector;
import android.media.MediaMetadataRetriever;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.animation.LinearInterpolator;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextClock;
import android.widget.TextView;
import android.widget.VideoView;
import java.io.File;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Full-screen photos and videos with a small clock, shown natively over the
 * dashboard. Landscape photos fill the screen, cropped around faces; portraits
 * pair up side by side; a lone narrow photo sits on a blurred copy of itself.
 * Every photo slowly pans and zooms, and screens crossfade. A loader thread
 * decodes the next screen while the current one shows, so the main thread only
 * animates ready-made bitmaps (view-property animations on hardware layers,
 * which this GPU composites cheaply). Videos play muted through the hardware
 * decoder. Main thread only, except the loader's own state.
 */
final class Slideshow {
    private static final String TAG = "KidsDash";
    /** A video that never reports completion still moves on after this. */
    private static final long VIDEO_TIMEOUT_MS = 3 * 60_000;
    private static final long RETRY_MS = 1_000;
    private static final int BACKGROUND = 0xff120e0e;
    /** Gap between paired portraits. */
    private static final int GUTTER = 12;
    /** Darkens the blurred backdrop so the photo on it stands out. */
    private static final int BACKDROP_DIM = 0x73000000;
    private static final int CLOCK_TIME_PX = 76;
    private static final int CLOCK_DATE_PX = 28;
    /** Digit height as a fraction of the font size (sans-serif). */
    private static final float CAP_HEIGHT = 0.71f;

    private final Context context;
    private final File dir;
    private final FrameLayout layer;
    private final ImageView videoBackdrop;
    private final VideoView video;
    private final View clock;
    private final LinearLayout weather;
    private final ImageView weatherArt;
    private final TextView weatherNow;
    private final TextView weatherRange;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable advance = this::advance;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();

    private List<SlideshowPolicy.Slide> slides = new ArrayList<>();
    private boolean showing;
    /** Bumped on show/hide so loads for an earlier session are dropped. */
    private int generation;
    /** The screen on show (null while a video plays alone). */
    private FrameLayout stage;
    /** The next screen, decoded ahead. */
    private Prepared ready;
    private boolean loading;
    /** The timer fired before the next screen was ready. */
    private boolean due;
    private Bitmap videoBackdropBitmap;
    /** The video on show, so a playback error can name it. */
    private File playingVideo;
    /**
     * Videos this frame cannot decode (iPhone HDR HEVC, say): skipped until the
     * app restarts, rather than probed and failed every few minutes. Written on
     * the main thread, read by the loader.
     */
    private final Set<String> unplayable = ConcurrentHashMap.newKeySet();

    // Loader-thread state.
    private List<SlideshowPolicy.Slide> loaderSlides = new ArrayList<>();
    private final ArrayDeque<int[]> queue = new ArrayDeque<>();
    private final Map<String, Float> aspects = new HashMap<>();
    private final Random random = new Random();
    private int lastShown = -1;

    Slideshow(Context context, File dir) {
        this.context = context;
        this.dir = dir;
        layer = new FrameLayout(context);
        layer.setBackgroundColor(BACKGROUND);
        layer.setVisibility(View.GONE);

        videoBackdrop = new ImageView(context);
        videoBackdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        videoBackdrop.setColorFilter(BACKDROP_DIM, PorterDuff.Mode.SRC_ATOP);
        videoBackdrop.setVisibility(View.GONE);
        layer.addView(videoBackdrop, new FrameLayout.LayoutParams(-1, -1));

        video = new VideoView(context);
        video.setVisibility(View.GONE);
        video.setOnPreparedListener(this::onVideoPrepared);
        video.setOnInfoListener((player, what, extra) -> {
            if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) fadeOutStage();
            return false;
        });
        video.setOnCompletionListener(player -> advance());
        video.setOnErrorListener((player, what, extra) -> {
            if (playingVideo != null) unplayable.add(playingVideo.getName());
            Log.w(TAG, "Slide video failed (" + what + "/" + extra + "), skipping it from now on: "
                    + (playingVideo != null ? playingVideo.getName() : "?"));
            handler.removeCallbacks(advance);
            handler.postDelayed(advance, RETRY_MS);
            return true; // no system error dialog
        });
        layer.addView(video, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        clock = clock(context);
        layer.addView(clock, clockParams());

        // Mirrors the clock: the temperature now at the time's size over
        // "high / low" at the date's size, then the sky sticker. The sticker
        // spans from the top of the big digits down to the small line's
        // baseline, its bottom on that baseline.
        weather = new LinearLayout(context);
        weather.setOrientation(LinearLayout.HORIZONTAL);
        weather.setGravity(Gravity.BOTTOM);
        weather.setVisibility(View.GONE);
        LinearLayout temps = new LinearLayout(context);
        temps.setOrientation(LinearLayout.VERTICAL);
        temps.setGravity(Gravity.END);
        weatherNow = new TextView(context);
        style(weatherNow, CLOCK_TIME_PX, Typeface.BOLD);
        temps.addView(weatherNow);
        weatherRange = new TextView(context);
        style(weatherRange, CLOCK_DATE_PX, Typeface.NORMAL);
        temps.addView(weatherRange);
        weather.addView(temps);
        weatherArt = new ImageView(context);
        weatherArt.setScaleType(ImageView.ScaleType.FIT_END);
        weatherArt.setAdjustViewBounds(true);
        android.graphics.Paint.FontMetricsInt big = weatherNow.getPaint().getFontMetricsInt();
        android.graphics.Paint.FontMetricsInt small = weatherRange.getPaint().getFontMetricsInt();
        float capGap = -big.ascent - CAP_HEIGHT * CLOCK_TIME_PX; // air above the digits
        int artHeight = Math.round((big.descent - big.ascent) - capGap + (-small.ascent));
        LinearLayout.LayoutParams artParams = new LinearLayout.LayoutParams(-2, artHeight);
        artParams.leftMargin = 20;
        artParams.bottomMargin = small.descent;
        weather.addView(weatherArt, artParams);
        FrameLayout.LayoutParams weatherParams =
                new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
        weatherParams.setMargins(0, 0, 56, 48);
        layer.addView(weather, weatherParams);
    }

    /** Temperature now, today's high and low and the sky sticker, bottom right; hidden without a forecast. */
    void setWeather(SlideshowPolicy.Weather forecast) {
        if (forecast == null) {
            weather.setVisibility(View.GONE);
            return;
        }
        try (java.io.InputStream in = context.getAssets().open("web/art/wx-" + forecast.sky + ".webp")) {
            weatherArt.setImageBitmap(trimmed(BitmapFactory.decodeStream(in)));
        } catch (java.io.IOException e) {
            weatherArt.setImageDrawable(null);
        }
        weatherNow.setText((forecast.current != null ? forecast.current : forecast.high) + "\u00b0");
        String high = forecast.high + "\u00b0";
        android.text.SpannableString range = new android.text.SpannableString(high + " / " + forecast.low + "\u00b0");
        range.setSpan(new android.text.style.ForegroundColorSpan(0xc8ffffff), high.length(), range.length(), 0);
        weatherRange.setText(range);
        weather.setVisibility(View.VISIBLE);
    }

    View view() {
        return layer;
    }

    boolean isShowing() {
        return showing;
    }

    int count() {
        return slides.size();
    }

    void setSlides(List<SlideshowPolicy.Slide> next) {
        slides = new ArrayList<>(next);
        List<SlideshowPolicy.Slide> copy = new ArrayList<>(next);
        loader.execute(() -> {
            if (!sameSlides(copy, loaderSlides)) {
                loaderSlides = copy;
                queue.clear();
                lastShown = -1;
            }
        });
        if (showing && slides.isEmpty()) hide();
    }

    void show() {
        if (showing || slides.isEmpty()) return;
        showing = true;
        generation++;
        due = true;
        layer.setVisibility(View.VISIBLE);
        Log.i(TAG, "Slideshow: on (" + slides.size() + " slides)");
        load();
    }

    void hide() {
        if (!showing) return;
        showing = false;
        generation++;
        handler.removeCallbacks(advance);
        video.stopPlayback();
        video.setVisibility(View.GONE);
        setVideoBackdrop(null);
        for (int i = layer.getChildCount() - 1; i >= 0; i--) {
            View child = layer.getChildAt(i);
            if (child.getTag() instanceof Prepared) removeStage((FrameLayout) child);
        }
        stage = null;
        if (ready != null) ready.recycle();
        ready = null;
        loading = false;
        due = false;
        layer.setVisibility(View.GONE);
        Log.i(TAG, "Slideshow: off");
    }

    // ---- Sequencing (main thread) ----

    /** Time for the next screen: show it if decoded, else as soon as it is. */
    private void advance() {
        handler.removeCallbacks(advance);
        if (!showing) return;
        if (ready != null) {
            Prepared next = ready;
            ready = null;
            present(next);
        } else {
            due = true;
        }
        load();
    }

    private void load() {
        if (loading || ready != null || !showing) return;
        loading = true;
        int gen = generation;
        int w = layer.getWidth() > 0 ? layer.getWidth() : 1920;
        int h = layer.getHeight() > 0 ? layer.getHeight() : 1080;
        loader.execute(() -> {
            Prepared prepared = prepareNext(w, h);
            handler.post(() -> {
                if (gen != generation) {
                    if (prepared != null) prepared.recycle();
                    return;
                }
                loading = false;
                if (prepared == null) {
                    // Nothing decodable right now (files still downloading?): try again shortly.
                    handler.postDelayed(advance, RETRY_MS * 5);
                    return;
                }
                ready = prepared;
                if (due) {
                    due = false;
                    advance();
                }
            });
        });
    }

    private void present(Prepared next) {
        if (next.videoFile != null) {
            playVideo(next);
            return;
        }
        FrameLayout incoming = buildStage(next);
        layer.addView(incoming, layer.indexOfChild(clock), new FrameLayout.LayoutParams(-1, -1)); // under the overlays
        FrameLayout outgoing = stage;
        stage = incoming;
        boolean overVideo = video.getVisibility() == View.VISIBLE;
        incoming.setAlpha(0f);
        incoming.animate()
                .alpha(1f)
                .setDuration(SlideshowPolicy.FADE_MS)
                .withLayer()
                .withEndAction(() -> {
                    if (outgoing != null) removeStage(outgoing);
                    if (overVideo && stage == incoming) {
                        video.stopPlayback();
                        video.setVisibility(View.GONE);
                        setVideoBackdrop(null);
                    }
                })
                .start();
        handler.postDelayed(advance, SlideshowPolicy.PHOTO_MS + SlideshowPolicy.FADE_MS);
    }

    private FrameLayout buildStage(Prepared p) {
        FrameLayout s = new FrameLayout(context);
        s.setBackgroundColor(BACKGROUND);
        s.setTag(p);
        long motionMs = SlideshowPolicy.PHOTO_MS + 3 * SlideshowPolicy.FADE_MS;
        if (p.backdrop != null) {
            ImageView back = new ImageView(context);
            back.setScaleType(ImageView.ScaleType.FIT_XY);
            back.setImageBitmap(p.backdrop);
            back.setColorFilter(BACKDROP_DIM, PorterDuff.Mode.SRC_ATOP);
            s.addView(back, new FrameLayout.LayoutParams(-1, -1));
            ImageView front = new ImageView(context);
            front.setScaleType(ImageView.ScaleType.FIT_CENTER);
            front.setImageBitmap(p.photos[0]);
            s.addView(front, new FrameLayout.LayoutParams(-1, -1));
            // A gentle push-in only: the whole photo stays in view.
            animate(front, new SlideshowPolicy.Motion(1f, 0, 0, 1.05f, 0, 0), motionMs);
            return s;
        }
        int panelW = p.photos.length == 2 ? p.panelW : -1;
        for (int i = 0; i < p.photos.length; i++) {
            FrameLayout panel = new FrameLayout(context); // clips its photo's zoom
            ImageView image = new ImageView(context);
            image.setScaleType(ImageView.ScaleType.FIT_XY);
            image.setImageBitmap(p.photos[i]);
            panel.addView(image, new FrameLayout.LayoutParams(-1, -1));
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(panelW, -1);
            lp.leftMargin = i == 0 ? 0 : p.panelW + GUTTER;
            s.addView(panel, lp);
            animate(image, p.motions[i], motionMs);
        }
        return s;
    }

    private static void animate(View view, SlideshowPolicy.Motion m, long durationMs) {
        view.setScaleX(m.fromScale);
        view.setScaleY(m.fromScale);
        view.setTranslationX(m.fromX);
        view.setTranslationY(m.fromY);
        view.animate()
                .scaleX(m.toScale)
                .scaleY(m.toScale)
                .translationX(m.toX)
                .translationY(m.toY)
                .setDuration(durationMs)
                .setInterpolator(new LinearInterpolator())
                .withLayer()
                .start();
    }

    /**
     * Shown bitmaps are left to the garbage collector rather than recycled: the
     * render thread may still be drawing the last frame that used them.
     */
    private void removeStage(FrameLayout s) {
        s.animate().cancel();
        layer.removeView(s);
    }

    // ---- Video ----

    private void playVideo(Prepared p) {
        setVideoBackdrop(p.backdrop);
        p.backdrop = null; // now owned by the video backdrop
        video.setVisibility(View.VISIBLE);
        playingVideo = p.videoFile;
        video.setVideoPath(p.videoFile.getPath());
        handler.postDelayed(advance, VIDEO_TIMEOUT_MS);
    }

    private void onVideoPrepared(MediaPlayer player) {
        player.setVolume(0f, 0f);
        player.setLooping(false);
        int vw = player.getVideoWidth(), vh = player.getVideoHeight();
        int sw = layer.getWidth(), sh = layer.getHeight();
        if (vw > 0 && vh > 0 && sw > 0 && sh > 0) {
            // Wide videos fill the screen (edges cropped off-screen); others fit on the backdrop.
            boolean fill = (float) vw / vh >= SlideshowPolicy.FILL_FROM_ASPECT;
            float scale = fill ? Math.max((float) sw / vw, (float) sh / vh) : Math.min((float) sw / vw, (float) sh / vh);
            FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(vw * scale), Math.round(vh * scale), Gravity.CENTER);
            video.setLayoutParams(lp);
            videoBackdrop.setVisibility(fill || videoBackdropBitmap == null ? View.GONE : View.VISIBLE);
        }
        video.start();
    }

    /** The video's first frame is up: fade the previous photos away over it. */
    private void fadeOutStage() {
        FrameLayout outgoing = stage;
        stage = null;
        if (outgoing == null) return;
        outgoing.animate().alpha(0f).setDuration(SlideshowPolicy.FADE_MS).withLayer()
                .withEndAction(() -> removeStage(outgoing)).start();
    }

    private void setVideoBackdrop(Bitmap bitmap) {
        videoBackdrop.setImageBitmap(bitmap);
        videoBackdropBitmap = bitmap;
        if (bitmap == null) videoBackdrop.setVisibility(View.GONE);
    }

    // ---- Loading (loader thread) ----

    /** A decoded screen: one or two photos, or a video with its backdrop. */
    private static final class Prepared {
        Bitmap[] photos;
        SlideshowPolicy.Motion[] motions;
        Bitmap backdrop;
        File videoFile;
        int panelW;

        void recycle() {
            if (photos != null) for (Bitmap b : photos) if (b != null) b.recycle();
            if (backdrop != null) backdrop.recycle();
            photos = null;
            backdrop = null;
        }
    }

    private Prepared prepareNext(int w, int h) {
        for (int attempt = 0; attempt <= loaderSlides.size(); attempt++) {
            if (queue.isEmpty()) refill();
            int[] screen = queue.poll();
            if (screen == null) return null;
            lastShown = screen[screen.length - 1];
            try {
                Prepared p = prepare(screen, w, h);
                if (p != null) return p;
            } catch (RuntimeException | OutOfMemoryError e) {
                Log.w(TAG, "Slide skipped: " + e);
            }
        }
        return null;
    }

    private void refill() {
        int n = loaderSlides.size();
        boolean[] pairable = new boolean[n];
        for (int i = 0; i < n; i++) {
            SlideshowPolicy.Slide s = loaderSlides.get(i);
            Float aspect = s.video ? null : aspect(file(s));
            pairable[i] = aspect != null && aspect < SlideshowPolicy.PAIR_BELOW_ASPECT;
        }
        queue.addAll(SlideshowPolicy.plan(SlideshowPolicy.order(n, lastShown, random), pairable));
    }

    private Float aspect(File file) {
        Float known = aspects.get(file.getName());
        if (known != null) return known;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getPath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null; // not downloaded yet
        float aspect = (float) bounds.outWidth / bounds.outHeight;
        aspects.put(file.getName(), aspect);
        return aspect;
    }

    private Prepared prepare(int[] screen, int w, int h) {
        for (int index : screen) if (index >= loaderSlides.size()) return null;
        Prepared p = new Prepared();
        SlideshowPolicy.Slide first = loaderSlides.get(screen[0]);
        if (first.video) {
            File f = file(first);
            if (!f.exists() || unplayable.contains(f.getName())) return null;
            p.videoFile = f;
            p.backdrop = videoBackdrop(f);
            return p;
        }
        if (screen.length == 2) {
            p.panelW = (w - GUTTER) / 2;
            p.photos = new Bitmap[2];
            p.motions = new SlideshowPolicy.Motion[2];
            for (int i = 0; i < 2; i++) {
                float[] focus = new float[2];
                p.photos[i] = cover(file(loaderSlides.get(screen[i])), p.panelW, h, focus);
                if (p.photos[i] == null) {
                    p.recycle();
                    return null;
                }
                p.motions[i] = SlideshowPolicy.kenBurns(random, p.panelW, h, focus[0], focus[1]);
            }
            return p;
        }
        File f = file(first);
        Float aspect = aspect(f);
        if (aspect == null) return null;
        if (aspect >= SlideshowPolicy.FILL_FROM_ASPECT) {
            float[] focus = new float[2];
            Bitmap photo = cover(f, w, h, focus);
            if (photo == null) return null;
            p.photos = new Bitmap[] {photo};
            p.motions = new SlideshowPolicy.Motion[] {SlideshowPolicy.kenBurns(random, w, h, focus[0], focus[1])};
            return p;
        }
        Bitmap source = decode(f, w, h);
        if (source == null) return null;
        p.photos = new Bitmap[] {source};
        p.backdrop = blurred(source, w, h);
        return p;
    }

    private File file(SlideshowPolicy.Slide slide) {
        return new File(dir, slide.sha256);
    }

    /**
     * The photo cropped and scaled to exactly fill w x h, the crop centred on
     * any faces. `focusOut` receives the focus as fractions of the result.
     */
    private static Bitmap cover(File file, int w, int h, float[] focusOut) {
        Bitmap source = decode(file, w, h);
        if (source == null) return null;
        float[] focus = faceFocus(source);
        int[] crop = SlideshowPolicy.coverCrop(source.getWidth(), source.getHeight(), w, h, focus[0], focus[1]);
        Matrix scale = new Matrix();
        scale.setScale((float) w / crop[2], (float) h / crop[3]);
        focusOut[0] = (focus[0] * source.getWidth() - crop[0]) / crop[2];
        focusOut[1] = (focus[1] * source.getHeight() - crop[1]) / crop[3];
        Bitmap result = Bitmap.createBitmap(source, crop[0], crop[1], crop[2], crop[3], scale, true);
        if (result != source) source.recycle();
        return result;
    }

    /**
     * Where the faces are, as fractions of the bitmap (eyes midpoint, nudged
     * down to the face's middle), or a default a little above centre.
     */
    private static float[] faceFocus(Bitmap source) {
        float[] fallback = {SlideshowPolicy.DEFAULT_FOCUS_X, SlideshowPolicy.DEFAULT_FOCUS_Y};
        try {
            int sw = 320; // FaceDetector needs an even width and RGB_565
            int sh = Math.max(2, Math.round(sw * (float) source.getHeight() / source.getWidth()));
            Bitmap scaled = Bitmap.createScaledBitmap(source, sw, sh, true);
            Bitmap small = scaled.copy(Bitmap.Config.RGB_565, false);
            if (scaled != source) scaled.recycle();
            FaceDetector.Face[] faces = new FaceDetector.Face[6];
            int found = new FaceDetector(sw, sh, faces.length).findFaces(small, faces);
            small.recycle();
            if (found <= 0) return fallback;
            float x = 0, y = 0, weight = 0;
            PointF mid = new PointF();
            for (int i = 0; i < found; i++) {
                FaceDetector.Face face = faces[i];
                if (face == null || face.confidence() < 0.3f) continue;
                face.getMidPoint(mid);
                float eyes = face.eyesDistance();
                x += mid.x * eyes;
                y += (mid.y + eyes * 0.5f) * eyes;
                weight += eyes;
            }
            if (weight == 0) return fallback;
            return new float[] {x / weight / sw, y / weight / sh};
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    /** A dark, soft copy of the image, tiny (it is scaled up on screen). */
    private static Bitmap blurred(Bitmap source, int w, int h) {
        int bw = 64, bh = Math.max(1, Math.round(64f * h / w));
        int[] crop = SlideshowPolicy.coverCrop(source.getWidth(), source.getHeight(), w, h, 0.5f, 0.5f);
        Bitmap cropped = Bitmap.createBitmap(source, crop[0], crop[1], crop[2], crop[3]);
        Bitmap small = Bitmap.createScaledBitmap(cropped, bw, bh, true);
        if (cropped != source && cropped != small) cropped.recycle();
        int[] pixels = new int[bw * bh];
        small.getPixels(pixels, 0, bw, 0, 0, bw, bh);
        SlideshowPolicy.blur(pixels, bw, bh, 3);
        Bitmap out = small.isMutable() ? small : small.copy(Bitmap.Config.ARGB_8888, true);
        if (out != small) small.recycle();
        out.setPixels(pixels, 0, bw, 0, 0, bw, bh);
        return out;
    }

    private static Bitmap videoBackdrop(File file) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getPath());
            Bitmap frame = retriever.getFrameAtTime(0);
            if (frame == null) return null;
            Bitmap out = blurred(frame, 1920, 1080);
            if (out != frame) frame.recycle();
            return out;
        } catch (RuntimeException e) {
            return null;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // nothing to release
            }
        }
    }

    /** Decodes at no less than the target size (for a clean downscale) but no more than twice it. */
    static Bitmap decode(File file, int width, int height) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getPath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= width && bounds.outHeight / (sample * 2) >= height) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeFile(file.getPath(), options);
    }

    private static boolean sameSlides(List<SlideshowPolicy.Slide> a, List<SlideshowPolicy.Slide> b) {
        if (a.size() != b.size()) return false;
        for (int i = 0; i < a.size(); i++) if (!a.get(i).sha256.equals(b.get(i).sha256)) return false;
        return true;
    }

    /** The sticker without its transparent margin, so its size and bottom are the art's own. */
    private static Bitmap trimmed(Bitmap art) {
        if (art == null) return null;
        int w = art.getWidth(), h = art.getHeight();
        int[] pixels = new int[w * h];
        art.getPixels(pixels, 0, w, 0, 0, w, h);
        int left = w, top = h, right = -1, bottom = -1;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if ((pixels[y * w + x] >>> 24) > 160) {
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
        }
        if (right < left) return art;
        return Bitmap.createBitmap(art, left, top, right - left + 1, bottom - top + 1);
    }

    // ---- Clock ----

    private static View clock(Context context) {
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.START);

        TextClock time = new TextClock(context);
        time.setFormat12Hour("h:mm");
        time.setFormat24Hour("h:mm");
        style(time, CLOCK_TIME_PX, Typeface.BOLD);
        box.addView(time);

        TextClock date = new TextClock(context);
        date.setFormat12Hour("EEEE, MMMM d");
        date.setFormat24Hour("EEEE, MMMM d");
        style(date, CLOCK_DATE_PX, Typeface.NORMAL);
        box.addView(date);
        return box;
    }

    private static void style(TextView text, int px, int weight) {
        text.setTextColor(0xffffffff);
        text.setTextSize(TypedValue.COMPLEX_UNIT_PX, px);
        text.setTypeface(Typeface.create("sans-serif-medium", weight));
        text.setShadowLayer(18, 0, 2, 0xb3000000);
        text.setIncludeFontPadding(false);
    }

    private static FrameLayout.LayoutParams clockParams() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.START);
        params.setMargins(56, 0, 0, 48);
        return params;
    }
}
