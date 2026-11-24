import type { HistoryEvent, Place, PlaceKind } from "@kids-dash/core";
import { monthDay, weekdayLong } from "../format";
import { html, type Raw } from "../html";

const CLOSE = html`<button type="button" class="joke-close" data-action="close-sheet" aria-label="Close">
  <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
</button>`;

/** "On this day": a few things that happened on this date, oldest first, one picture. */
export function historySheet(events: readonly HistoryEvent[], date: string): Raw {
  const picture = events.find((e) => e.image)?.image ?? null;
  return html`<div class="sheet-card facts-sheet" role="dialog" aria-label="On this day" data-action="noop">
    <div class="joke-top">
      <span class="joke-tag">ON THIS DAY</span>
      <span class="facts-when">${weekdayLong(date)}, ${monthDay(date)}</span>
      ${CLOSE}
    </div>
    <div class="facts-body">
      ${picture ? html`<img class="history-picture" src="${picture}" alt="">` : ""}
      <ol class="history-list">${events.map(
        (e) =>
          html`<li class="history-event"><span class="history-year">${String(e.year)}</span><span class="history-text">${e.text}</span></li>`,
      )}</ol>
    </div>
    <span class="trivia-credit">From Wikipedia's "On this day" (CC BY-SA)</span>
  </div>`;
}

const KIND_LABELS: Record<PlaceKind, string> = {
  country: "COUNTRY",
  state: "US STATE",
  city: "BIG CITY",
};

/** The day's place: its locator map, a few facts and the start of its Wikipedia article. */
export function placeSheet(place: Place): Raw {
  return html`<div class="sheet-card facts-sheet" role="dialog" aria-label="${place.name}" data-action="noop">
    <div class="joke-top">
      <span class="joke-tag">${KIND_LABELS[place.kind]}</span>
      <span class="facts-when">Let's go to…</span>
      ${CLOSE}
    </div>
    <h2 class="place-name">${place.name}${place.where ? html`<span class="place-where">in ${place.where}</span>` : ""}</h2>
    <div class="facts-body">
      ${place.map ? html`<img class="place-map" src="${place.map}" alt="Map showing where ${place.name} is">` : ""}
      <div class="place-text">
        ${place.facts.length ? html`<dl class="place-facts">${place.facts.map((f) => html`<div class="place-fact"><dt>${f.label}</dt><dd>${f.value}</dd></div>`)}</dl>` : ""}
        <p class="place-blurb">${place.blurb}</p>
      </div>
    </div>
    <span class="trivia-credit">Facts from Wikidata and Wikipedia (CC BY-SA); map from Wikimedia Commons</span>
  </div>`;
}
