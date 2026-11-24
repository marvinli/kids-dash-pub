import type { HistoryEvent, IsoDate, Place, PlaceKind } from "@kids-dash/core";
import { z } from "zod";
import type { HistoryReader, PlaceCandidate, PlaceReader } from "../services/ports";

/** Wikimedia asks API clients to name themselves; a generic name, no contact details. */
const USER_AGENT = "kids-dash/1.0 (family dashboard)";
const ON_THIS_DAY = "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday";
const SPARQL = "https://query.wikidata.org/sparql";
const SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary";
const FILE_PATH = "https://commons.wikimedia.org/wiki/Special:FilePath";

/** Events per day, and the most an event's text may run to (it shows in big type). */
export const HISTORY_PER_DAY = 3;
const HISTORY_MAX_TEXT = 240;
/** Pictures ride inside the bundle: keep them small. */
const MAX_HISTORY_IMAGE = 150_000;
const MAX_MAP_IMAGE = 300_000;
const MAP_WIDTH = 420;

/**
 * "On this day" is mostly wars, disasters and crimes. A kids' screen keeps
 * the rest: anything mentioning these is left out.
 */
const GRIM =
  /\b(kill\w*|dead|death\w*|die[ds]?|dying|murder\w*|massacre\w*|wars?|warfare|battle\w*|attack\w*|bomb\w*|shoot\w*|shot|guns?|gunm\w*|terror\w*|assassin\w*|execut\w*|suicide\w*|genocide|riot\w*|explo\w*|crash\w*|disaster\w*|fires?|burn\w*|earthquake\w*|tsunami\w*|hurricane\w*|cyclone\w*|typhoon\w*|flood\w*|famine|epidemic\w*|pandemic\w*|invade\w*|invasion\w*|occup\w*|siege\w*|coup\w*|arrest\w*|prison\w*|jail\w*|hostage\w*|kidnap\w*|slave\w*|rap(e|ed|ist)|abuse\w*|nuclear|weapon\w*|missile\w*|arm(y|ies)|military|troops?|soldier\w*|navy|naval|airstrike\w*|hijack\w*|tortur\w*|lynch\w*|nazi\w*|holocaust|sank|sink\w*|wreck\w*|injur\w*|wound\w*|victim\w*|casualt\w*|collaps\w*|accident\w*|poison\w*|bloody|violen\w*|crimin\w*|crime\w*|sentenc\w*|trial|fatal\w*|drown\w*|rebel\w*|revolt\w*|insurgen\w*|guerr?illa\w*|capture\w*|surrender\w*|annex\w*|treaty)\b/i;

const OnThisDayPage = z.object({ thumbnail: z.object({ source: z.string() }).optional() });
const OnThisDayEvent = z.object({
  text: z.string(),
  year: z.number().int(),
  pages: z.array(OnThisDayPage).optional(),
});
const OnThisDay = z.object({
  selected: z.array(OnThisDayEvent).optional(),
  events: z.array(OnThisDayEvent).optional(),
});

const Binding = z.object({ value: z.string() });
const SparqlResults = z.object({
  results: z.object({ bindings: z.array(z.record(z.string(), Binding)) }),
});
const Summary = z.object({ extract: z.string() });

/** Which items each kind is, in Wikidata. */
const KIND_CLASS: Record<PlaceKind, string> = {
  country: "wd:Q6256", // country
  state: "wd:Q35657", // U.S. state
  city: "wd:Q1637706", // city with millions of inhabitants
};

/**
 * Wikipedia's "On this day" and Wikidata/Wikipedia/Commons for places. All
 * keyless; text is CC BY-SA (credited on the frame), Wikidata is CC0.
 */
export class WikimediaReader implements HistoryReader, PlaceReader {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async onThisDay(date: IsoDate): Promise<HistoryEvent[]> {
    const [, month, day] = date.split("-");
    const [selected, all] = await Promise.all([
      this.json(`${ON_THIS_DAY}/selected/${month}/${day}`, OnThisDay),
      this.json(`${ON_THIS_DAY}/events/${month}/${day}`, OnThisDay),
    ]);
    // Wikipedia's editors' picks first, then the full list; nothing grim, nothing long.
    const seen = new Set<string>();
    const kept = [...(selected.selected ?? []), ...(all.events ?? [])].filter((e) => {
      if (seen.has(e.text) || GRIM.test(e.text) || e.text.length > HISTORY_MAX_TEXT) return false;
      seen.add(e.text);
      return true;
    });
    const chosen = kept.slice(0, HISTORY_PER_DAY).sort((a, b) => a.year - b.year);
    // One picture: the first chosen event that has one.
    const withPicture = chosen.find((e) => e.pages?.[0]?.thumbnail);
    const picture = withPicture?.pages?.[0]?.thumbnail?.source;
    const image = picture ? await this.image(picture, MAX_HISTORY_IMAGE).catch(() => null) : null;
    return chosen.map((e) => ({
      year: e.year,
      text: e.text.trim(),
      image: e === withPicture ? image : null,
    }));
  }

  async candidates(kind: PlaceKind): Promise<PlaceCandidate[]> {
    const query = `SELECT ?item ?title (SAMPLE(?name) AS ?label) (SAMPLE(?map) AS ?locator)
  (MAX(?pop) AS ?population) (MAX(?area) AS ?areaKm2) (SAMPLE(?capName) AS ?capital) (SAMPLE(?countryName) AS ?country)
WHERE {
  ?item wdt:P31 ${KIND_CLASS[kind]}; wdt:P242 ?map; rdfs:label ?name. FILTER(LANG(?name) = "en")
  ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?title.
  FILTER NOT EXISTS { ?item wdt:P576 [] }
  OPTIONAL { ?item wdt:P1082 ?pop }
  OPTIONAL { ?item p:P2046/psv:P2046 [ wikibase:quantityAmount ?area; wikibase:quantityUnit wd:Q712226 ] }
  OPTIONAL { ?item wdt:P36 ?cap. ?cap rdfs:label ?capName. FILTER(LANG(?capName) = "en") }
  OPTIONAL { ?item wdt:P17 ?c. ?c rdfs:label ?countryName. FILTER(LANG(?countryName) = "en") }
}
GROUP BY ?item ?title`;
    const response = await this.fetchFn(SPARQL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ query }).toString(),
    });
    if (!response.ok) throw new Error(`Wikidata answered ${response.status}`);
    const rows = SparqlResults.parse(await response.json()).results.bindings;
    return rows.flatMap((row) => {
      const id = row.item?.value.split("/").pop();
      const map = row.locator?.value.split("/Special:FilePath/").pop();
      const name = row.label?.value;
      const title = row.title?.value;
      if (!id || !map || !name || !title) return [];
      const number = (key: string) => {
        const n = Number(row[key]?.value);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      return [
        {
          id,
          kind,
          name,
          title,
          map: decodeURIComponent(map),
          population: number("population"),
          areaKm2: number("areaKm2"),
          capital: row.capital?.value ?? null,
          country: kind === "city" ? (row.country?.value ?? null) : null,
        },
      ];
    });
  }

  async describe(place: PlaceCandidate): Promise<Place> {
    const [summary, map] = await Promise.all([
      this.json(`${SUMMARY}/${encodeURIComponent(place.title.replace(/ /g, "_"))}`, Summary),
      this.image(
        `${FILE_PATH}/${encodeURIComponent(place.map)}?width=${MAP_WIDTH}`,
        MAX_MAP_IMAGE,
      ).catch(() => null),
    ]);
    return {
      kind: place.kind,
      name: place.name,
      where: place.country,
      map,
      facts: placeFacts(place),
      blurb: firstSentences(summary.extract, 2, 320),
    };
  }

  private async json<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Wikimedia answered ${response.status} for ${url}`);
    return schema.parse(await response.json());
  }

  /** A picture as a data: URL, refused when it is not an image or too big. */
  private async image(url: string, maxBytes: number): Promise<string> {
    const response = await this.fetchFn(url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`image answered ${response.status}`);
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!/^image\/(png|jpeg|gif|webp)$/.test(type)) throw new Error(`not a picture: ${type}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`picture too big: ${bytes.length}`);
    return `data:${type};base64,${bytes.toString("base64")}`;
  }
}

/** Capital (or country, for a city), population and area in square miles. */
export function placeFacts(place: PlaceCandidate): Place["facts"] {
  const facts: Place["facts"] = [];
  if (place.kind === "city" && place.country)
    facts.push({ label: "Country", value: place.country });
  if (place.kind !== "city" && place.capital)
    facts.push({ label: "Capital", value: place.capital });
  if (place.population) facts.push({ label: "People", value: people(place.population) });
  if (place.areaKm2) {
    const sqMi = Math.round(place.areaKm2 * 0.386102);
    facts.push({ label: "Size", value: `${sqMi.toLocaleString("en-US")} square miles` });
  }
  return facts;
}

/** 39,538,223 → "39.5 million"; 644,663 → "644,663". */
export function people(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")} billion`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} million`;
  return Math.round(n).toLocaleString("en-US");
}

/** The first `count` sentences, cut at `max` characters on a word. */
export function firstSentences(text: string, count: number, max: number): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = sentences.slice(0, count).join("").trim();
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return out;
}
