import type { DashboardBundle, WeekDay } from "@kids-dash/core";
import { describe, expect, it } from "vitest";
import { jokesFor } from "../jokes";
import { sampleBundle } from "../test-bundle";
import { addChoreSheet, newChoreDraft, presetDays, toggleDay } from "./add-chore";
import { cheer, choresScreen } from "./chores";
import type { ViewContext } from "./common";
import { historySheet, placeSheet } from "./facts";
import { jokeSheet } from "./joke";
import { timeline, todayScreen } from "./today";
import { TRIVIA_CREDIT, triviaSheet } from "./trivia";
import { rainLine, weatherCard } from "./weather";
import { dateSpan, daySheet, titleLines, weekScreen } from "./week";

const ctx = (bundle: DashboardBundle, overrides: Partial<ViewContext> = {}): ViewContext => ({
  now: new Date("2026-11-16T12:42:00Z"),
  photos: {},
  isDone: (kidId, choreId) =>
    bundle.kids.find((k) => k.id === kidId)?.chores.find((c) => c.id === choreId)?.done ?? false,
  ...overrides,
});

function dom(markup: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = markup;
  return root;
}

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.trim());

describe("today", () => {
  const bundle = sampleBundle();

  it("greets the kids by time of day and shows each kid's day with specials first", () => {
    const root = dom(todayScreen(bundle, ctx(bundle)).__raw);
    expect(root.querySelector("h1")?.textContent).toBe("Good morning, Maya & Theo!");
    expect(texts(root, ".kid-column h2")).toEqual(["Maya", "Theo"]);

    const nana = { ...bundle, device: { id: "d1", name: "Nana frame", greetingName: "Nana" } };
    const greeted = dom(todayScreen(nana, ctx(nana)).__raw);
    expect(greeted.querySelector("h1")?.textContent).toBe("Good morning, Nana!");
    const theo = root.querySelectorAll(".kid-column")[1] as HTMLElement;
    expect(texts(theo, ".special-title, .activity-title")).toEqual([
      "A friend comes over",
      "Art club",
    ]);
    expect(texts(theo, ".badge")).toEqual(["PLAYDATE"]);
    expect(texts(theo, ".special-time")).toEqual(["4:30"]);
    expect(texts(theo, ".note span")).toEqual(["Bring your green folder"]);
  });

  it("shows each kid's chores as a count that opens the Chores screen", () => {
    const root = dom(todayScreen(bundle, ctx(bundle)).__raw);
    expect(texts(root, ".kid-column .chore-card-count")).toEqual(["3 of 6 done", "1 of 6 done"]);
    expect((root.querySelector(".chore-card") as HTMLElement).dataset.action).toBe("chores");
    // All done turns it sunny; a kid with no chores has no card.
    const done = dom(todayScreen(bundle, ctx(bundle, { isDone: () => true })).__raw);
    expect(done.querySelectorAll(".chore-card.all-done")).toHaveLength(2);
    const none = { ...bundle, kids: bundle.kids.map((k, i) => (i ? { ...k, chores: [] } : k)) };
    expect(dom(todayScreen(none, ctx(none)).__raw).querySelectorAll(".chore-card")).toHaveLength(1);
    // The week strip counts each day's chores per kid.
    expect(texts(root, ".strip-day.is-today .strip-chore")).toEqual(["M 3/6", "T 1/6"]);
    expect(root.querySelectorAll(".strip-chores")).toHaveLength(7);
  });

  it("collapses a busy day into a more chip instead of overflowing", () => {
    const busy = sampleBundle();
    const kid = busy.kids[0];
    if (!kid) throw new Error("no kid");
    const extra = Array.from({ length: 8 }, (_, i) => ({
      id: `x${i}`,
      title: `Thing ${i}`,
      note: null,
      time: "18:00",
      endTime: null,
      sticker: "star" as const,
      badge: null,
      details: null,
    }));
    kid.activities.push(...extra);
    const root = dom(todayScreen(busy, ctx(busy)).__raw);
    const column = root.querySelector(".kid-column") as HTMLElement;
    expect(column.querySelector(".more-chip")?.textContent).toMatch(/^\+\d+ more$/);
    expect(column.querySelectorAll(".special, .activity, .note").length).toBeLessThan(11);
  });

  it("has friendly empty states", () => {
    const empty: DashboardBundle = {
      ...bundle,
      weather: null,
      location: null,
      familyNotes: [{ id: "pic", text: "Picture day!" }],
      kids: bundle.kids.map((k) => ({ ...k, specials: [], activities: [], notes: [], chores: [] })),
      week: bundle.week.map((d) => ({ ...d, items: [] })),
    };
    const root = dom(todayScreen(empty, ctx(empty)).__raw);
    expect(texts(root, ".free-day span")).toEqual([
      "Nothing planned. Free play!",
      "Nothing planned. Free play!",
    ]);
    expect(root.querySelector(".chores-button")).toBeNull();
    expect(texts(root, ".family-note")).toEqual(["Picture day!"]);
    expect(texts(root, ".strip-quiet")).toHaveLength(7);
    expect(root.querySelector(".weather-empty")?.textContent).toBe("No forecast yet");

    const noKids = dom(todayScreen({ ...empty, kids: [] }, ctx(empty)).__raw);
    expect(noKids.querySelector("h1")?.textContent).toBe("Good morning!");
    expect(noKids.querySelector(".empty-setup")).not.toBeNull();
  });

  it("uses a kid's photo when the shell supplied one", () => {
    const root = dom(
      todayScreen(bundle, ctx(bundle, { photos: { maya: "data:image/png;base64,AA" } })).__raw,
    );
    expect(root.querySelector("img.avatar")?.getAttribute("src")).toBe("data:image/png;base64,AA");
    expect(texts(root, ".avatar-initial")).toEqual(["T"]);
  });

  it("escapes calendar text", () => {
    const evil = sampleBundle();
    const kid = evil.kids[0];
    if (!kid?.specials[0]) throw new Error("no special");
    kid.specials[0].title = '<img src=x onerror="alert(1)">';
    const root = dom(todayScreen(evil, ctx(evil)).__raw);
    expect(root.querySelector(".special-title img")).toBeNull();
    expect(root.querySelector(".special-title")?.textContent).toBe(
      '<img src=x onerror="alert(1)">',
    );
  });
});

describe("today's timeline", () => {
  const item = (id: string, time: string | null, endTime: string | null = null) => ({
    id,
    title: id,
    note: null,
    details: null,
    time,
    endTime,
    sticker: "star" as const,
    badge: null,
  });

  it("fades what is over, tags what is next and leaves untimed items alone", () => {
    const states = timeline(
      [
        item("trip", "09:00", "14:00"),
        item("art", "15:15"),
        item("ballet", "16:30"),
        item("note", null),
      ],
      "15:30",
    );
    expect(Object.fromEntries(states)).toEqual({ trip: "past", art: "next", ballet: "later" });
  });

  it("counts an item without an end time as an hour long", () => {
    expect(timeline([item("art", "15:15")], "16:14").get("art")).toBe("next");
    expect(timeline([item("art", "15:15")], "16:15").get("art")).toBe("past");
  });

  it("renders the states and colours each kid's name in the greeting", () => {
    const bundle = sampleBundle();
    // 4:00 pm in New York: the 9:00 field trip is over, Ballet at 4:30 is next.
    const root = dom(
      todayScreen(bundle, ctx(bundle, { now: new Date("2026-11-16T21:00:00Z") })).__raw,
    );
    const maya = root.querySelectorAll(".kid-column")[0] as HTMLElement;
    expect(maya.querySelector(".special")?.classList.contains("is-past")).toBe(true);
    expect(maya.querySelector(".activity.is-next .activity-title")?.textContent).toBe("Ballet");
    expect(maya.textContent).not.toMatch(/UP NEXT/);
    const names = [...root.querySelectorAll("h1 span[style]")].map((n) => n.getAttribute("style"));
    expect(names).toEqual([
      "--name-ink:#8e2a54;--name-light:#ffe0ea",
      "--name-ink:#1d5583;--name-light:#dceffc",
    ]);
    expect(root.querySelector(".greeting-art")?.getAttribute("src")).toBe("art/wx-partly.webp");
    expect(root.textContent).not.toMatch(/You've got this/);
  });
});

describe("rail and joke", () => {
  const bundle = sampleBundle();

  it("puts the fun modes down the right, sleep at the foot, the joke marked new", () => {
    const fresh = dom(todayScreen(bundle, ctx(bundle, { canSleep: true, jokeNew: true })).__raw);
    expect(texts(fresh, ".rail .rail-label")).toEqual([
      "Joke",
      "Trivia",
      "History",
      "Places",
      "Sleep",
    ]);
    expect(fresh.querySelector("[data-action='joke'] .rail-new")?.textContent).toBe("NEW");
    expect(fresh.querySelector(".rail-foot")?.getAttribute("data-action")).toBe("sleep");
    expect(fresh.querySelector(".top [data-action='sleep']")).toBeNull();
    const withPhotos = { ...bundle, slides: [{ sha256: "a".repeat(64), kind: "photo" as const }] };
    const heard = dom(todayScreen(withPhotos, ctx(withPhotos)).__raw);
    expect(texts(heard, ".rail .rail-label")).toEqual([
      "Photos",
      "Joke",
      "Trivia",
      "History",
      "Places",
    ]);
    // Without the day's trivia, history and place, only the joke is left.
    const none = { ...bundle, trivia: [], history: [], place: null };
    expect(texts(dom(todayScreen(none, ctx(none)).__raw), ".rail .rail-label")).toEqual(["Joke"]);
    const started = dom(todayScreen(bundle, ctx(bundle, { triviaNew: true })).__raw);
    expect(started.querySelector("[data-action='trivia'] .rail-new")).not.toBeNull();
    expect(heard.querySelector("[data-action='joke'] .rail-new")).toBeNull();
  });

  it("tells the setup, then the punchline, then another or more tomorrow", () => {
    const jokes = jokesFor("2026-11-18");
    const first = dom(jokeSheet(jokes, 0, false).__raw);
    expect(first.querySelector(".joke-tag")?.textContent).toBe("JOKE OF THE DAY");
    expect(first.querySelector(".joke-setup")?.textContent).toBe(jokes[0]?.setup);
    expect(first.querySelector(".joke-punch")).toBeNull();
    expect(first.querySelector("[data-action='joke-reveal']")).not.toBeNull();
    const told = dom(jokeSheet(jokes, 0, true).__raw);
    expect(told.querySelector(".joke-punch")?.textContent).toBe(jokes[0]?.punchline);
    expect(told.querySelector("[data-action='joke-next']")).not.toBeNull();
    const last = dom(jokeSheet(jokes, jokes.length - 1, true).__raw);
    expect(last.querySelector(".joke-tag")?.textContent).toBe("BONUS JOKE 3 OF 3");
    expect(last.querySelector("[data-action='joke-next']")).toBeNull();
    expect(last.querySelector(".joke-done")?.textContent).toMatch(/More tomorrow/);
    expect(jokeSheet(jokes, 9, false).__raw).toBe("");
  });
});

describe("trivia", () => {
  const questions = sampleBundle().trivia;

  it("asks, then lights the right answer and cheers or gently corrects", () => {
    const asked = dom(triviaSheet(questions, 0, [null, null, null]).__raw);
    expect(asked.querySelector(".joke-tag")?.textContent).toBe("TRIVIA · 1 OF 3");
    expect(asked.querySelector(".trivia-category")?.textContent).toBe("Science");
    expect(texts(asked, ".trivia-text")).toEqual(["A kit", "A pup", "A calf", "A cub"]);
    expect(asked.querySelectorAll(".trivia-answer:disabled")).toHaveLength(0);
    expect(asked.querySelector(".trivia-result")).toBeNull();
    expect(asked.querySelector(".trivia-credit")?.textContent).toBe(TRIVIA_CREDIT);

    const right = dom(triviaSheet(questions, 0, [1, null, null]).__raw);
    expect(right.querySelector(".trivia-answer.is-right .trivia-text")?.textContent).toBe("A pup");
    expect(right.querySelector(".trivia-verdict")?.textContent).toBe("You got it!");
    expect(right.querySelectorAll(".trivia-answer:disabled")).toHaveLength(4);
    expect(right.querySelector("[data-action='trivia-next']")).not.toBeNull();

    const wrong = dom(triviaSheet(questions, 0, [3, null, null]).__raw);
    expect(wrong.querySelector(".trivia-answer.is-picked .trivia-text")?.textContent).toBe("A cub");
    expect(wrong.querySelector(".trivia-verdict")?.textContent).toBe("Not quite! It's A pup.");
  });

  it("ends with the score", () => {
    const score = (picks: number[]) =>
      dom(triviaSheet(questions, 2, picks).__raw).querySelector(".trivia-score")?.textContent;
    expect(score([1, 2, 0])).toBe("3 of 3, perfect!");
    expect(score([1, 0, 0])).toBe("2 of 3, nice!");
    expect(score([0, 0, 1])).toBe("0 of 3. New ones tomorrow!");
    expect(triviaSheet(questions, 5, []).__raw).toBe("");
  });
});

describe("history and places", () => {
  const bundle = sampleBundle();
  const pixel = "data:image/png;base64,iVBORw0KGgo=";

  it("lists what happened on this day, with its picture", () => {
    const plain = dom(historySheet(bundle.history, bundle.date).__raw);
    expect(plain.querySelector(".facts-when")?.textContent).toBe("Monday, Nov 16");
    expect(texts(plain, ".history-year")).toEqual(["1928", "1991", "2011"]);
    expect(plain.querySelector(".history-picture")).toBeNull();
    const events = bundle.history.map((e, i) => (i === 1 ? { ...e, image: pixel } : e));
    const pictured = dom(historySheet(events, bundle.date).__raw);
    expect(pictured.querySelector(".history-picture")?.getAttribute("src")).toBe(pixel);
    expect(pictured.querySelector(".trivia-credit")?.textContent).toMatch(/Wikipedia/);
  });

  it("shows the place with its map and facts", () => {
    const place = bundle.place;
    if (!place) throw new Error("no place");
    const state = dom(placeSheet(place).__raw);
    expect(state.querySelector(".joke-tag")?.textContent).toBe("US STATE");
    expect(state.querySelector(".place-name")?.textContent).toBe("Vermont");
    expect(texts(state, ".place-fact dt")).toEqual(["Capital", "People"]);
    expect(state.querySelector(".place-map")).toBeNull();
    const city = dom(
      placeSheet({ ...place, kind: "city", where: "Japan", map: pixel, facts: [] }).__raw,
    );
    expect(city.querySelector(".joke-tag")?.textContent).toBe("BIG CITY");
    expect(city.querySelector(".place-where")?.textContent).toBe("in Japan");
    expect(city.querySelector(".place-map")?.getAttribute("src")).toBe(pixel);
    expect(city.querySelector(".place-facts")).toBeNull();
  });
});

describe("weather", () => {
  it("dresses the bear for the forecast", () => {
    const root = dom(
      weatherCard(
        { high: 52, low: 41, rainChance: 80, code: 61, current: null, sunrise: null, sunset: null },
        "Home",
      ).__raw,
    );
    expect(root.querySelector(".wear-tip")?.textContent).toBe("Raincoat + rain boots");
    expect(texts(root, ".wear-piece")).toEqual(["Raincoat", "+ rain boots"]);
    // A long one-piece tip wraps after its commas.
    const cold = dom(
      weatherCard(
        { high: 64, low: 38, rainChance: 0, code: 0, current: 40, sunrise: null, sunset: null },
        "Home",
      ).__raw,
    );
    expect(texts(cold, ".wear-piece")).toEqual(["Puffy coat,", "hat & mittens"]);
    expect(cold.querySelector(".wear-tip")?.textContent).toBe("Puffy coat, hat & mittens");
    expect(root.querySelector(".wear-bear")?.getAttribute("src")).toBe("art/polarbear-rain.webp");
    expect(root.querySelector(".weather-sky-art")?.getAttribute("src")).toBe("art/wx-rainy.webp");
    // The sticker says the sky, so no word for it; current temperature leads, else the high.
    expect(root.querySelector(".weather-sky-art")?.getAttribute("alt")).toBe("Rainy");
    expect(root.querySelector(".weather-now")?.textContent).toBe("52°");
    expect(root.querySelector(".weather-range")?.textContent).toBe("High 52° · Low 41°");
    const now = dom(
      weatherCard(
        { high: 52, low: 41, rainChance: 0, code: 3, current: 47, sunrise: null, sunset: null },
        "Home",
      ).__raw,
    );
    expect(now.querySelector(".weather-now")?.textContent).toBe("47°");
    expect(root.textContent).not.toMatch(/outside today/i);
    const rain = root.querySelector(".weather-rain");
    expect(rain?.querySelector(".rain-text")?.textContent).toBe("Rain likely");
    expect(rain?.querySelector(".rain-chance")?.textContent).toBe("80%");
    expect(rain?.querySelector<HTMLElement>(".rain-meter > span")?.style.width).toBe("80%");
    expect(rain?.classList.contains("wet")).toBe(true);
  });

  it("describes light rain chances and hides an empty detail", () => {
    const some = dom(
      weatherCard(
        { high: 70, low: 60, rainChance: 40, code: 2, current: null, sunrise: null, sunset: null },
        null,
      ).__raw,
    );
    expect(some.querySelector(".rain-text")?.textContent).toBe("Maybe rain");
    expect(some.querySelector(".rain-chance")?.textContent).toBe("40%");
    expect(some.querySelector(".wear-detail")).toBeNull();
    const none = dom(
      weatherCard(
        { high: 70, low: 60, rainChance: 0, code: 0, current: null, sunrise: null, sunset: null },
        null,
      ).__raw,
    );
    const none2 = none.querySelector(".weather-rain");
    // A dry day: just the words, no meter or number.
    expect(none2?.textContent?.trim()).toBe("No rain");
    expect(none2?.classList.contains("dry")).toBe(true);
    expect(none2?.classList.contains("wet")).toBe(false);
    expect(none2?.querySelector(".rain-meter")).toBeNull();
    expect(rainLine(20)).toEqual({ text: "Chance of rain", chance: 20, wet: false });
  });

  it("says the forecast is coming once a location is set", () => {
    expect(dom(weatherCard(null, "Home").__raw).querySelector(".weather-empty")?.textContent).toBe(
      "The forecast is on its way",
    );
  });
});

describe("week", () => {
  const bundle = sampleBundle();

  it("pages Monday-to-Sunday weeks midweek, fading the days gone", () => {
    const wed = sampleBundle({ now: new Date("2026-11-18T15:00:00Z") });
    const root = dom(weekScreen(wed, ctx(wed)).__raw);
    expect(texts(root, ".week-day .dow")[0]).toBe("MON");
    expect(root.querySelectorAll(".week-day.is-past")).toHaveLength(2);
    expect(root.querySelector(".week-day.is-today .dom")?.textContent).toBe("18");
    expect(root.querySelector(".week-title")?.textContent).toBe("This weekNov 16 – 22");
    const next = dom(weekScreen(wed, ctx(wed), 1).__raw);
    expect(next.querySelector(".week-title")?.textContent).toBe("Next weekNov 23 – 29");
    const strip = dom(todayScreen(wed, ctx(wed)).__raw);
    expect(texts(strip, ".strip-day .dow")).toEqual([
      "MON",
      "TUE",
      "TODAY",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
    expect(strip.querySelectorAll(".strip-day.is-past")).toHaveLength(2);
  });

  it("ends each day with its chores per kid, opening the Chores screen on that day", () => {
    const root = dom(weekScreen(bundle, ctx(bundle)).__raw);
    const monday = root.querySelector(".week-day .week-chores") as HTMLElement;
    expect(monday.dataset).toMatchObject({ action: "chores", date: "2026-11-16" });
    expect(texts(monday, ".week-chore")).toEqual(["M3/6", "T1/6"]);
    expect(root.querySelectorAll(".week-chores")).toHaveLength(7);
    const free = { ...bundle, days: bundle.days.map((d) => ({ ...d, chores: [] })) };
    expect(dom(weekScreen(free, ctx(free)).__raw).querySelector(".week-chores")).toBeNull();
  });

  it("shows seven days from today with owners and times", () => {
    const root = dom(weekScreen(bundle, ctx(bundle)).__raw);
    expect(texts(root, ".week-day .dow")).toEqual([
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
      "SAT",
      "SUN",
    ]);
    expect(root.querySelector(".week-day.is-today .today-tag")).not.toBeNull();
    expect(root.querySelector(".week-title")?.textContent).toBe("This weekNov 16 – 22");
    expect(dateSpan("2026-11-30", "2026-12-06")).toBe("Nov 30 – Dec 6");
    const friday = root.querySelectorAll(".week-day")[4] as HTMLElement;
    expect(texts(friday, ".who-chip")).toEqual(["Theo"]);
    expect(texts(friday, ".week-time")).toEqual(["5:00"]);
    expect(friday.querySelector(".week-item.is-special")).not.toBeNull();
    const tuesday = root.querySelectorAll(".week-day")[1] as HTMLElement;
    expect(texts(tuesday, ".week-time")).toEqual(["4:00"]);
  });

  it("wraps titles in full, sizes items by their lines, and opens a day with more than fits", () => {
    expect(titleLines("Swim")).toBe(1);
    expect(titleLines("Miniature Makers at Maple Barn")).toBe(3);
    expect(titleLines("Supercalifragilisticexpialidocious")).toBe(3);
    expect(titleLines("Hi Supercalifragilisticexpialidocious")).toBe(4);
    const item = (i: number) => ({
      id: `b${i}`,
      title: "A rather long activity title that wraps",
      owner: { kind: "everyone" as const },
      time: "09:00",
      sticker: "star" as const,
      special: false,
      note: null,
      details: null,
    });
    const busy: DashboardBundle = {
      ...bundle,
      days: [],
      week: bundle.week.map((d, i) => ({
        ...d,
        items: i === 2 ? [0, 1, 2, 3, 4, 5].map(item) : [],
      })),
    };
    const root = dom(weekScreen(busy, ctx(busy)).__raw);
    const wed = root.querySelectorAll(".week-day")[2] as HTMLElement;
    const shown = wed.querySelectorAll(".week-item").length;
    expect(shown).toBeLessThan(6);
    const more = wed.querySelector('[data-action="day"]');
    expect(more?.textContent).toBe(`+${6 - shown} more`);
    expect(more?.getAttribute("data-date")).toBe(busy.week[2]?.date);
    const sheet = dom(daySheet(busy.week[2] as WeekDay, busy).__raw);
    expect(sheet.querySelectorAll(".week-item")).toHaveLength(6);
    expect(sheet.querySelector(".sheet-title")?.textContent).toBe("Wed Nov 18");
  });

  it("labels free days and falls back to Everyone for unknown owners", () => {
    const odd: DashboardBundle = {
      ...bundle,
      days: [],
      week: bundle.week.map((d, i) =>
        i === 0
          ? {
              ...d,
              items: [
                {
                  id: "x",
                  title: "Swim",
                  owner: { kind: "kid", kidId: "sam" },
                  time: null,
                  sticker: "star",
                  special: false,
                  note: null,
                  details: null,
                },
              ],
            }
          : { ...d, items: [] },
      ),
    };
    const root = dom(weekScreen(odd, ctx(odd)).__raw);
    expect(texts(root, ".who-chip")).toEqual(["Everyone"]);
    expect(texts(root, ".week-free")).toHaveLength(6);
    const noWeek = dom(weekScreen({ ...odd, week: [] }, ctx(odd)).__raw);
    expect(noWeek.querySelector(".week-dates")).toBeNull();
  });
});

describe("chores", () => {
  const bundle = sampleBundle();

  it("groups chores by period with done state and progress stars", () => {
    const root = dom(choresScreen(bundle, ctx(bundle)).__raw);
    const maya = root.querySelector(".chore-panel") as HTMLElement;
    expect(texts(maya, ".period-label")).toEqual(["MORNING", "AFTER SCHOOL"]);
    expect(maya.querySelectorAll(".chore-tile.done")).toHaveLength(3);
    expect(maya.querySelector(".chore-count")?.textContent).toBe("3 of 6 done");
    expect(maya.querySelector(".cheer span")?.textContent).toBe("3 more to go. You can do it!");
    const tile = maya.querySelector(".chore-tile") as HTMLElement;
    expect(tile.dataset).toMatchObject({
      action: "toggle-chore",
      kid: "maya",
      date: "2026-11-16",
    });
    expect(root.querySelector(".chore-day-name")?.textContent).toBe("Monday, Nov 16");
    expect(root.querySelector(".chore-day-rel")?.textContent).toBe("Today");
  });

  it("shows another day: earlier ones can be caught up, days ahead only shown", () => {
    const wed = sampleBundle({ now: new Date("2026-11-18T15:00:00Z"), done: [] });
    const at = (date: string) => dom(choresScreen(wed, ctx(wed), date).__raw);
    const tuesday = at("2026-11-17");
    expect(tuesday.querySelector(".chore-day-rel")?.textContent).toBe("Yesterday");
    expect(tuesday.querySelectorAll(".chore-tile.missed")).toHaveLength(12);
    expect(tuesday.querySelector(".cheer span")?.textContent).toBe("0 of 6 done that day");
    expect((tuesday.querySelector(".chore-tile") as HTMLElement).dataset.date).toBe("2026-11-17");
    const allDone = dom(choresScreen(wed, ctx(wed, { isDone: () => true }), "2026-11-17").__raw);
    expect(texts(allDone, ".celebrate span:not(.celebrate-title)")[0]).toBe(
      "A super star that day",
    );

    const saturday = at("2026-11-21");
    expect(saturday.querySelector(".chore-day-rel")?.textContent).toBe("Coming up");
    expect(saturday.querySelector("[data-action='toggle-chore']")).toBeNull();
    expect(texts(saturday, ".chore-count")).toEqual(["6 chores", "6 chores"]);
    expect(saturday.querySelector(".cheer span")?.textContent).toBe("6 chores on Saturday");
    expect(at("2026-11-19").querySelector(".chore-day-rel")?.textContent).toBe("Tomorrow");
    expect(at("2026-11-10").querySelector(".chore-day-rel")?.textContent).toBe("Earlier");

    // The arrows stop at the ends of the bundle's days; an unknown day shows today.
    const first = wed.days[0]?.date ?? "";
    expect(at(first).querySelector("[data-step='-1']")?.hasAttribute("disabled")).toBe(true);
    expect(
      at(wed.days.at(-1)?.date ?? "")
        .querySelector("[data-step='1']")
        ?.hasAttribute("disabled"),
    ).toBe(true);
    expect(at("2030-01-01").querySelector(".chore-day-rel")?.textContent).toBe("Today");
    // A day with none, and an old bundle without days: just today.
    const free = { ...wed, days: wed.days.map((d) => ({ ...d, chores: [] })) };
    expect(
      dom(choresScreen(free, ctx(free), "2026-11-21").__raw).querySelector(".chores-empty h2")
        ?.textContent,
    ).toBe("No chores on Saturday");
    const old = { ...wed, days: [], week: [] };
    expect(
      dom(choresScreen(old, ctx(old), "2026-11-17").__raw).querySelector(".chore-day-rel")
        ?.textContent,
    ).toBe("Today");
  });

  it("celebrates when everything is done", () => {
    const root = dom(choresScreen(bundle, ctx(bundle, { isDone: () => true })).__raw);
    expect(texts(root, ".celebrate-title")).toEqual(["All done, Maya!", "All done, Theo!"]);
  });

  it("has an empty state", () => {
    const none = { ...bundle, kids: bundle.kids.map((k) => ({ ...k, chores: [] })) };
    expect(
      dom(choresScreen(none, ctx(none)).__raw).querySelector(".chores-empty h2")?.textContent,
    ).toBe("No chores today!");
  });

  it("cheers by how much is left", () => {
    expect(cheer(4, 4)).toBe("Let's get started!");
    expect(cheer(1, 4)).toBe("Just 1 more to go!");
    expect(cheer(2, 4)).toBe("2 more to go. You can do it!");
  });
});

describe("add chore", () => {
  it("presets and day toggles", () => {
    expect(presetDays("weekends")).toEqual([0, 6]);
    expect(presetDays("bogus")).toBeNull();
    expect(toggleDay([0, 6], 3)).toEqual([0, 3, 6]);
    expect(toggleDay([0, 6], 6)).toEqual([0]);
    expect(toggleDay([6], 6)).toEqual([6]);
  });

  it("picks the only kid, and explains failures", () => {
    const bundle = sampleBundle();
    const one = { ...bundle, kids: bundle.kids.slice(0, 1) };
    expect(newChoreDraft(one).kidId).toBe(one.kids[0]?.id);
    expect(newChoreDraft(bundle).kidId).toBeNull();
    const failed = addChoreSheet({ ...newChoreDraft(bundle), error: "offline" }, bundle).__raw;
    expect(failed).toContain("Couldn’t save. Is the frame online?");
  });
});
