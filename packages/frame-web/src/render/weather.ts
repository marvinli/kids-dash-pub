import { type Weather, wearTip } from "@kids-dash/core";
import { html, type Raw } from "../html";
import { art } from "../theme";

const SKY_BACKGROUNDS = {
  sunny: "#fff1c9",
  partly: "#fdf0d8",
  cloudy: "#e9eef6",
  foggy: "#eceff3",
  rainy: "#dcebfb",
  snowy: "#e6edff",
  stormy: "#e3e2f3",
} as const;

/** It is the weather, so it is outside and it is today: no labels needed. */
export function weatherCard(weather: Weather | null, location: string | null): Raw {
  if (!weather) {
    return html`<section class="card weather" style="background:#f3efe6">
      <img class="weather-empty-art bob" src="${art.sky("cloudy")}" alt="" width="200" height="200">
      <p class="weather-empty">${location ? "The forecast is on its way" : "No forecast yet"}</p>
    </section>`;
  }

  const tip = wearTip(weather);
  const rain = rainLine(weather.rainChance);

  return html`<section class="card weather" style="--sky:${SKY_BACKGROUNDS[tip.sky]}">
    <div class="weather-hero">
      <span class="weather-now">${weather.current ?? weather.high}°</span>
      <span class="weather-range">High ${weather.high}° <span class="dot">·</span> Low ${weather.low}°</span>
      <img class="weather-sky-art bob" src="${art.sky(tip.sky)}" alt="${tip.skyLabel}" width="200" height="200">
    </div>
    ${rainStrip(rain)}
    <div class="wear">
      <img class="wear-bear" src="${art.bear(tip.bear)}" alt="Polar bear dressed for ${tip.skyLabel.toLowerCase()} weather" width="340" height="340">
      <div class="wear-text">
        <span class="wear-label">Wear</span>
        <span class="wear-tip">${wearPieces(tip.tip)}</span>
        ${tip.detail ? html`<span class="wear-detail">${tip.detail}</span>` : ""}
      </div>
    </div>
  </section>`;
}

/**
 * A tip breaks only between its pieces, never inside one: "Long sleeves" /
 * "+ a jacket", and "Puffy coat," / "hat & mittens" (a comma stays with the
 * piece before it, a "+" starts the piece after).
 */
export function wearPieces(tip: string): Raw[] {
  return tip
    .split(/(?<=,) | (?=\+ )/)
    .map((piece, i) => html`${i ? " " : ""}<span class="wear-piece">${piece}</span>`);
}

export interface RainLine {
  text: string;
  /** The chance, once it matters (10% and up); null on a dry day. */
  chance: number | null;
  /** 40% and up: the strip turns solid blue so it catches the eye. */
  wet: boolean;
}

/** The chance of rain in words, with the number once it matters. */
export function rainLine(chance: number): RainLine {
  if (chance < 10) return { text: "No rain", chance: null, wet: false };
  if (chance < 40) return { text: "Chance of rain", chance, wet: false };
  if (chance < 70) return { text: "Maybe rain", chance, wet: true };
  return { text: "Rain likely", chance, wet: true };
}

/**
 * Rain gets a full-width strip of its own, the same size every day: the words
 * on the left (clipped, never wrapped), then a meter filled to the chance and
 * the number, so a long phrase can never push into the temperatures.
 */
function rainStrip(rain: RainLine): Raw {
  const wet = rain.wet ? " wet" : "";
  const dry = rain.chance === null ? " dry" : "";
  return html`<div class="weather-rain${wet}${dry}">
    ${dropSvg()}<span class="rain-text">${rain.text}</span>
    ${
      rain.chance === null
        ? ""
        : html`<span class="rain-meter" aria-hidden="true"><span style="width:${rain.chance}%"></span></span>
    <span class="rain-chance">${rain.chance}%</span>`
    }
  </div>`;
}

function dropSvg(): Raw {
  return html`<svg width="22" height="28" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 2C13 2 3 15 3 22a10 10 0 0 0 20 0C23 15 13 2 13 2Z" fill="currentColor"/></svg>`;
}
