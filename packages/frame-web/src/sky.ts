/**
 * Day, dusk and night versions of each backdrop painting, crossfaded around
 * sunrise and sunset. Pure: the time is the family's local wall clock and the
 * sun times come from the bundle's weather.
 *
 * The blend moves in a few discrete steps rather than animating: each step is
 * one repaint of a static image, which the frame's GPU can afford (see the
 * performance rules at the top of styles/app.css). Dusk doubles as dawn.
 */
export type Light = "day" | "dusk" | "night";

/** Steps per crossfade (each one a single repaint). */
export const STEPS = 6;
/** A crossfade starts this long before (or after) the sun time... */
export const FADE_MIN = 45;
/** ...and dusk is held, unblended, this long either side of it. */
export const HOLD_MIN = 10;
/** When the bundle has no sun times (weather unavailable). */
export const FALLBACK_SUNRISE = "06:45";
export const FALLBACK_SUNSET = "17:45";

/** Show `from`, with `to` blended over it by `amount` (0, 1/STEPS, ..., (STEPS-1)/STEPS). */
export interface SkyBlend {
  from: Light;
  to: Light;
  amount: number;
}

const DAY_MIN = 24 * 60;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function skyBlend(now: string, sunrise: string | null, sunset: string | null): SkyBlend {
  let rise = minutes(sunrise ?? FALLBACK_SUNRISE);
  let set = minutes(sunset ?? FALLBACK_SUNSET);
  // The ramps must not overlap or wrap past midnight; otherwise use typical times.
  if (rise - FADE_MIN < 0 || set + FADE_MIN > DAY_MIN || rise + FADE_MIN > set - FADE_MIN) {
    rise = minutes(FALLBACK_SUNRISE);
    set = minutes(FALLBACK_SUNSET);
  }
  const keys: [number, Light][] = [
    [0, "night"],
    [rise - FADE_MIN, "night"],
    [rise - HOLD_MIN, "dusk"],
    [rise + HOLD_MIN, "dusk"],
    [rise + FADE_MIN, "day"],
    [set - FADE_MIN, "day"],
    [set - HOLD_MIN, "dusk"],
    [set + HOLD_MIN, "dusk"],
    [set + FADE_MIN, "night"],
  ];
  const m = minutes(now);
  for (let i = 0; i < keys.length - 1; i++) {
    const [start, from] = keys[i] as [number, Light];
    const [end, to] = keys[i + 1] as [number, Light];
    if (m >= end) continue;
    const step = Math.floor(((m - start) / (end - start)) * STEPS);
    return from === to || step === 0
      ? { from, to: from, amount: 0 }
      : { from, to, amount: step / STEPS };
  }
  // After the evening fade: night until midnight.
  return { from: "night", to: "night", amount: 0 };
}

const artFile = (name: string, light: Light, blur: boolean) =>
  `bg-${name}${light === "day" ? "" : `-${light}`}${blur ? "-blur" : ""}.webp`;

/** Every file a backdrop needs: day, dusk and night, each sharp and blurred. */
export function backdropFiles(name: string): string[] {
  return (["day", "dusk", "night"] as const).flatMap((light) => [
    artFile(name, light, false),
    artFile(name, light, true),
  ]);
}

/** The CSS image for a backdrop (or its pre-blurred frost copy) at this blend. */
export function backdropImage(name: string, blend: SkyBlend, blur = false): string {
  const url = (light: Light) => `url("art/${artFile(name, light, blur)}")`;
  if (blend.amount === 0) return url(blend.from);
  // Chromium's prefixed cross-fade: the percentage is how much of the second image shows.
  return `-webkit-cross-fade(${url(blend.from)}, ${url(blend.to)}, ${Math.round(blend.amount * 100)}%)`;
}

/** How bright each painting is behind the header (WCAG relative luminance, 0..1). */
export type HeaderTones = Readonly<Record<Light, number>>;

/** Relative luminance of the header's dark ink (#4a3a3a) and light ink (#fff7ee). */
const DARK_INK = 0.0479;
const LIGHT_INK = 0.9395;
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The header's ink over this blend of paintings: whichever of dark and light
 * text contrasts more with the band behind it. Measured per painting rather
 * than assumed from the clock: space or the deep sea can be dark at noon.
 */
export function headerInk(tones: HeaderTones, blend: SkyBlend): "dark" | "light" {
  const behind = tones[blend.from] * (1 - blend.amount) + tones[blend.to] * blend.amount;
  return contrast(LIGHT_INK, behind) > contrast(DARK_INK, behind) ? "light" : "dark";
}
