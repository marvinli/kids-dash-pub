import { describe, expect, it, vi } from "vitest";
import { firstSentences, people, placeFacts, WikimediaReader } from "./wikimedia";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Answers by URL: JSON for objects, a PNG for "png", a status for numbers. */
function reader(routes: Array<[RegExp, unknown]>) {
  const fetchFn = vi.fn(async (url: string, _init?: RequestInit) => {
    const hit = routes.find(([pattern]) => pattern.test(url));
    if (!hit) return new Response("nope", { status: 404 });
    const [, body] = hit;
    if (typeof body === "number") return new Response("", { status: body });
    if (body === "png") return new Response(PNG, { headers: { "content-type": "image/png" } });
    if (body === "html") return new Response("<p>", { headers: { "content-type": "text/html" } });
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  return { fetchFn, r: new WikimediaReader(fetchFn as unknown as typeof fetch) };
}

const event = (year: number, text: string, thumb = false) => ({
  year,
  text,
  pages: thumb ? [{ thumbnail: { source: `https://upload.example/${year}.png` } }] : [{}],
});

describe("WikimediaReader.onThisDay", () => {
  it("keeps the kid-friendly picks, oldest first, with one picture", async () => {
    const { fetchFn, r } = reader([
      [
        /selected\/11\/18$/,
        {
          selected: [
            event(2017, "A cyclone made landfall in Greece.", true),
            event(2011, "The video game Minecraft exited beta.", false),
            event(1999, "A bonfire collapsed, killing 12 people.", true),
            event(1991, "Uzbekistan adopted its flag.", true),
          ],
        },
      ],
      [
        /events\/11\/18$/,
        {
          events: [
            event(2011, "The video game Minecraft exited beta."),
            event(1928, "Mickey Mouse first appeared on screen.", true),
            event(1900, "x".repeat(300)),
          ],
        },
      ],
      [/upload\.example\/1928/, "png"],
    ]);
    const events = await r.onThisDay("2026-11-18");
    expect(events.map((e) => e.year)).toEqual([1928, 1991, 2011]);
    // The picture belongs to the oldest event that has one; the rest go without.
    expect(events[0]?.image).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(events[1]?.image).toBeNull();
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^kids-dash/);
  });

  it("goes without the picture when it will not do", async () => {
    const { r } = reader([
      [/selected/, { selected: [event(1991, "Uzbekistan adopted its flag.", true)] }],
      [/events/, {}],
      [/upload\.example/, "html"],
    ]);
    expect((await r.onThisDay("2026-11-18"))[0]?.image).toBeNull();
  });

  it("fails when the feed does", async () => {
    await expect(reader([[/onthisday/, 503]]).r.onThisDay("2026-11-18")).rejects.toThrow("503");
  });
});

describe("WikimediaReader places", () => {
  const row = (extra: Record<string, string>) =>
    Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }]));

  it("lists the places of a kind with a map and an article", async () => {
    const { fetchFn, r } = reader([
      [
        /query\.wikidata/,
        {
          results: {
            bindings: [
              row({
                item: "http://www.wikidata.org/entity/Q16551",
                title: "Vermont",
                label: "Vermont",
                locator:
                  "http://commons.wikimedia.org/wiki/Special:FilePath/Vermont%20in%20United%20States.svg",
                population: "643077",
                areaKm2: "24923",
                capital: "Montpelier",
              }),
              row({ item: "http://www.wikidata.org/entity/Q1", label: "No map" }),
            ],
          },
        },
      ],
    ]);
    const [vermont, ...rest] = await r.candidates("state");
    expect(rest).toEqual([]);
    expect(vermont).toEqual({
      id: "Q16551",
      kind: "state",
      name: "Vermont",
      title: "Vermont",
      map: "Vermont in United States.svg",
      population: 643077,
      areaKm2: 24923,
      capital: "Montpelier",
      country: null,
    });
    const init = fetchFn.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("wd%3AQ35657");
  });

  it("describes a place with its map, facts and the start of its article", async () => {
    const { fetchFn, r } = reader([
      [
        /page\/summary\/New_York_City$/,
        { extract: "New York is a city. It is big. It has parks." },
      ],
      [/Special:FilePath\/NYC%20map\.svg\?width=420$/, "png"],
    ]);
    const place = await r.describe({
      id: "Q60",
      kind: "city",
      name: "New York City",
      title: "New York City",
      map: "NYC map.svg",
      population: 8_258_035,
      areaKm2: 778.2,
      capital: null,
      country: "United States",
    });
    expect(place).toEqual({
      kind: "city",
      name: "New York City",
      where: "United States",
      map: `data:image/png;base64,${PNG.toString("base64")}`,
      facts: [
        { label: "Country", value: "United States" },
        { label: "People", value: "8.3 million" },
        { label: "Size", value: "300 square miles" },
      ],
      blurb: "New York is a city. It is big.",
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails when Wikidata does", async () => {
    await expect(reader([[/query\.wikidata/, 429]]).r.candidates("country")).rejects.toThrow("429");
  });
});

describe("place helpers", () => {
  it("formats people and facts", () => {
    expect(people(1_412_000_000)).toBe("1.4 billion");
    expect(people(39_538_223)).toBe("39.5 million");
    expect(people(2_000_000)).toBe("2 million");
    expect(people(644_663)).toBe("644,663");
    expect(
      placeFacts({
        id: "Q30",
        kind: "country",
        name: "x",
        title: "x",
        map: "x",
        population: null,
        areaKm2: null,
        capital: "Washington, D.C.",
        country: "ignored",
      }),
    ).toEqual([{ label: "Capital", value: "Washington, D.C." }]);
  });

  it("keeps the first sentences, cut on a word", () => {
    expect(firstSentences("One. Two! Three?", 2, 100)).toBe("One. Two!");
    expect(firstSentences("No full stop at all", 2, 100)).toBe("No full stop at all");
    expect(firstSentences("A very long sentence indeed.", 1, 12)).toBe("A very long…");
  });
});
