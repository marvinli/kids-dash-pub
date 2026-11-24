/**
 * Which painted backdrop sits behind the screens on a given day. Pure: the
 * date is the bundle's (the family's local day). Art lives at
 * art/bg-<name>[-dusk|-night][-blur].webp.
 *
 * A holiday's painting shows around that holiday. Other days rotate, one
 * painting a day, alternating between the season's paintings and the fun
 * year-round scenes (space, under the sea, underground, ...), each list
 * shuffled so nothing repeats until the whole list has shown.
 *
 * Only paintings that have shipped can be picked: `available` is the art
 * manifest that scripts/art/prep.py writes (backdrops.json), so new art joins
 * the rotation, or a holiday starts showing, as soon as it is prepared.
 */
export type Season = "winter" | "spring" | "summer" | "fall";

/** Each season's paintings: the original first, then the variations. */
export const SEASON_SCENES: Readonly<Record<Season, readonly string[]>> = {
  winter: ["winter", "winter-skating", "winter-village", "winter-arctic"],
  spring: ["spring", "spring-rain", "spring-garden", "spring-kites"],
  summer: ["summer", "summer-camping", "summer-boardwalk", "summer-sunflowers"],
  fall: ["fall", "fall-forest", "fall-hayride", "fall-geese-pond"],
};

/** Scenes that fit any time of year. */
export const FUN_SCENES: readonly string[] = [
  "outer-space",
  "underwater-reef",
  "underground-burrows",
  "candy-land",
  "dinosaur-valley",
  "deep-sea",
  "cloud-kingdom",
  "jungle-treehouse",
  "crystal-cave",
  "savanna-safari",
  "mushroom-forest",
  "volcano-island",
  "moon-base",
  "train-mountains",
  "pirate-cove",
  "teddy-bear-picnic",
  "capybara-hot-spring",
];

const DAY_MS = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(day(date) + days * DAY_MS);

// Lunisolar dates, checked against the Hebrew and Chinese calendars in the
// tests (the frame's WebView is not trusted to carry those calendars).

/** First night of Hanukkah (the candle lit that evening). */
export const HANUKKAH_FIRST_NIGHT: Readonly<Record<number, string>> = {
  2025: "2025-12-14",
  2026: "2026-12-04",
  2027: "2027-12-24",
  2028: "2028-12-12",
  2029: "2029-12-01",
  2030: "2030-12-20",
  2031: "2031-12-09",
  2032: "2032-11-27",
  2033: "2033-12-16",
  2034: "2034-12-06",
  2035: "2035-12-25",
};
/** 1 Tishrei. */
export const ROSH_HASHANAH: Readonly<Record<number, string>> = {
  2025: "2025-09-23",
  2026: "2026-09-12",
  2027: "2027-10-02",
  2028: "2028-09-21",
  2029: "2029-09-10",
  2030: "2030-09-28",
  2031: "2031-09-18",
  2032: "2032-09-06",
  2033: "2033-09-24",
  2034: "2034-09-14",
  2035: "2035-10-04",
};
/** 15 Shevat. */
export const TU_BISHVAT: Readonly<Record<number, string>> = {
  2025: "2025-02-13",
  2026: "2026-02-02",
  2027: "2027-01-23",
  2028: "2028-02-12",
  2029: "2029-01-31",
  2030: "2030-01-19",
  2031: "2031-02-08",
  2032: "2032-01-28",
  2033: "2033-01-15",
  2034: "2034-02-04",
  2035: "2035-01-25",
};
/** 14 Adar (Adar II in a leap year). */
export const PURIM: Readonly<Record<number, string>> = {
  2025: "2025-03-14",
  2026: "2026-03-03",
  2027: "2027-03-23",
  2028: "2028-03-12",
  2029: "2029-03-01",
  2030: "2030-03-19",
  2031: "2031-03-09",
  2032: "2032-02-26",
  2033: "2033-03-15",
  2034: "2034-03-05",
  2035: "2035-03-25",
};
/** 15 Nisan. */
export const PASSOVER: Readonly<Record<number, string>> = {
  2025: "2025-04-13",
  2026: "2026-04-02",
  2027: "2027-04-22",
  2028: "2028-04-11",
  2029: "2029-03-31",
  2030: "2030-04-18",
  2031: "2031-04-08",
  2032: "2032-03-27",
  2033: "2033-04-14",
  2034: "2034-04-04",
  2035: "2035-04-24",
};
/** First day of the first lunar month. */
export const LUNAR_NEW_YEAR: Readonly<Record<number, string>> = {
  2025: "2025-01-29",
  2026: "2026-02-17",
  2027: "2027-02-07",
  2028: "2028-01-26",
  2029: "2029-02-13",
  2030: "2030-02-02",
  2031: "2031-01-23",
  2032: "2032-02-11",
  2033: "2033-01-31",
  2034: "2034-02-19",
  2035: "2035-02-08",
};

/** US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1, 12));
  const toThursday = (4 - first.getUTCDay() + 7) % 7;
  return iso(first.getTime() + (toThursday + 21) * DAY_MS);
}

/** Western Easter Sunday (the anonymous Gregorian computus). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOfMonth = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(Date.UTC(year, month - 1, dayOfMonth, 12));
}

/** [first, last] days, inclusive. */
type Span = readonly [string, string];

/** Spans around a table date: `before` days ahead of it through `after` days past it. */
const around =
  (table: Readonly<Record<number, string>>, before: number, after: number) =>
  (year: number): Span[] =>
    // Last year's too, for spans that cross New Year.
    [table[year - 1], table[year]].flatMap((d) =>
      d ? [[shift(d, -before), shift(d, after)] as const] : [],
    );

/** A fixed calendar day (or a few), every year. */
const yearly =
  (from: string, to = from) =>
  (year: number): Span[] => [[`${year}-${from}`, `${year}-${to}`]];

/**
 * Holidays. When two cover the same day (Hanukkah and Christmas, Passover and
 * Easter), or a holiday has more than one painting, they take turns, a day each. Big ones
 * show for days around them; the small, silly ones only on the day.
 */
export const HOLIDAYS: readonly {
  name: string;
  spans: (year: number) => Span[];
  /** More paintings of the same holiday, taking turns with the first. */
  also?: readonly string[];
}[] = [
  // All eight nights, and the morning after the last.
  { name: "hanukkah", spans: around(HANUKKAH_FIRST_NIGHT, 0, 8), also: ["hanukkah-lights"] },
  // The week leading up to it through the long weekend.
  {
    name: "thanksgiving",
    spans: (y) => [[shift(thanksgiving(y), -6), shift(thanksgiving(y), 3)]],
  },
  // Erev through the second day.
  { name: "rosh-hashanah", spans: around(ROSH_HASHANAH, 1, 1) },
  // Erev Sukkot (14 Tishrei) through Simchat Torah (23 Tishrei).
  {
    name: "sukkot",
    spans: (y) =>
      around(ROSH_HASHANAH, 0, 0)(y).map(([rh]) => [shift(rh, 13), shift(rh, 22)] as const),
  },
  // Erev Pesach through the eighth day.
  { name: "passover", spans: around(PASSOVER, 1, 7) },
  // Christmas Eve's eve through Christmas Day.
  { name: "christmas", spans: yearly("12-23", "12-25") },
  // Easter weekend.
  { name: "easter", spans: (y) => [[shift(easter(y), -1), easter(y)]] },
  { name: "purim", spans: around(PURIM, 1, 0) },
  { name: "tu-bishvat", spans: around(TU_BISHVAT, 0, 0) },
  { name: "lunar-new-year", spans: around(LUNAR_NEW_YEAR, 1, 2) },
  {
    name: "new-year",
    spans: (y) => [
      [`${y - 1}-12-31`, `${y}-01-02`],
      [`${y}-12-31`, `${y + 1}-01-02`],
    ],
  },
  { name: "valentines", spans: yearly("02-07", "02-14") },
  { name: "halloween", spans: yearly("10-24", "10-31") },
  { name: "fourth-of-july", spans: yearly("07-03", "07-04") },
  { name: "groundhog-day", spans: yearly("02-02") },
  { name: "st-patricks", spans: yearly("03-17") },
  { name: "earth-day", spans: yearly("04-22") },
  // The silly days borrow a fun scene.
  { name: "dinosaur-valley", spans: yearly("06-01") }, // Dinosaur Day
  { name: "underwater-reef", spans: yearly("06-08") }, // World Ocean Day
  { name: "teddy-bear-picnic", spans: yearly("07-10") }, // Teddy Bear Picnic Day
  { name: "moon-base", spans: yearly("07-20") }, // Moon Day
  { name: "pirate-cove", spans: yearly("09-19") }, // Talk Like a Pirate Day
];

export function seasonOf(date: string): Season {
  const month = Number(date.slice(5, 7));
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

interface HolidayPick {
  holiday: string;
  scene: string;
}

/**
 * The day's holiday painting. Overlapping holidays take turns a day each, then
 * a holiday's own paintings take turns; neither repeats from the day before
 * when there is a choice. Recurses only through consecutive holiday days.
 */
function holidayAt(t: number, available: ReadonlySet<string>): HolidayPick | null {
  const year = new Date(t).getUTCFullYear();
  const on = HOLIDAYS.filter(({ spans }) =>
    spans(year).some(([from, to]) => t >= day(from) && t <= day(to)),
  )
    .map(({ name, also = [] }) => ({
      holiday: name,
      scenes: [name, ...also].filter((scene) => available.has(scene)),
    }))
    .filter(({ scenes }) => scenes.length);
  if (!on.length) return null;
  const index = Math.floor(t / DAY_MS);
  const yesterday = holidayAt(t - DAY_MS, available);
  const turn = <T>(list: readonly T[], same: (item: T) => boolean): T => {
    const pick = list[index % list.length] as T;
    return list.length > 1 && same(pick) ? (list[(index + 1) % list.length] as T) : pick;
  };
  const { holiday, scenes } = turn(on, (h) => h.holiday === yesterday?.holiday);
  return { holiday, scene: turn(scenes, (scene) => scene === yesterday?.scene) };
}

export function holidayFor(date: string, available: ReadonlySet<string>): string | null {
  return holidayAt(day(date), available)?.scene ?? null;
}

/** A small deterministic PRNG (mulberry32), so every frame agrees on the day's pick. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list: readonly string[], seed: number): string[] {
  const out = [...list];
  const next = random(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}

/**
 * The k-th pick from a list, cycling through fresh shuffles: every item shows
 * once per cycle, and a cycle never starts with the one that ended the last.
 */
export function rotation(list: readonly string[], k: number, salt: number): string {
  const n = list.length;
  // Two or fewer: just take turns (the swap below would undo itself).
  if (n <= 2) return list[k % n] as string;
  const cycle = Math.floor(k / n);
  const order = (c: number) => shuffled(list, c * 7919 + salt);
  const current = order(cycle);
  if (current[0] === order(cycle - 1)[n - 1]) {
    [current[0], current[1]] = [current[1] as string, current[0] as string];
  }
  return current[k - cycle * n] as string;
}

export function backdropFor(date: string, available: ReadonlySet<string>): string {
  const holiday = holidayFor(date, available);
  if (holiday) return holiday;
  const season = SEASON_SCENES[seasonOf(date)];
  const seasonal = season.filter((s) => available.has(s));
  const fun = FUN_SCENES.filter((s) => available.has(s));
  const n = Math.floor(day(date) / DAY_MS);
  // Alternate: the season's paintings on even days, the fun scenes on odd
  // ones. A list on its own (the other has nothing shipped) takes every day.
  if (seasonal.length && fun.length) {
    return n % 2 === 0 ? rotation(seasonal, n / 2, 1) : rotation(fun, (n - 1) / 2, 2);
  }
  if (seasonal.length) return rotation(seasonal, n, 1);
  if (fun.length) return rotation(fun, n, 2);
  return season[0] as string;
}
