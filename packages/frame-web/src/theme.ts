import type { BearOutfit, ChoreSticker, EventSticker, KidColor, Sky } from "@kids-dash/core";

export interface KidPalette {
  /** Column background. */
  bg: string;
  /** Text and outlines; at least 4.5:1 on bg, chip and special. */
  ink: string;
  /** Time chips and done chores. */
  chip: string;
  /** Pinned specials. */
  special: string;
}

export const PALETTES: Record<KidColor, KidPalette> = {
  pink: { bg: "#ffe0ea", ink: "#8e2a54", chip: "#ffd0de", special: "#ffbfd3" },
  blue: { bg: "#dceffc", ink: "#1d5583", chip: "#c4e3fa", special: "#b4dbf8" },
  purple: { bg: "#ece4ff", ink: "#553a92", chip: "#ddd0fb", special: "#cfbdf7" },
  green: { bg: "#dff3e3", ink: "#2c6439", chip: "#c9ead0", special: "#b5e0bf" },
  orange: { bg: "#ffe8d6", ink: "#80430f", chip: "#ffd9bd", special: "#ffc9a1" },
};

/** CSS custom properties for a kid's subtree. */
export function paletteStyle(color: KidColor): string {
  const p = PALETTES[color];
  return `--kid-bg:${p.bg};--kid-ink:${p.ink};--kid-chip:${p.chip};--kid-special:${p.special}`;
}

export const art = {
  sticker: (id: EventSticker) => `art/stk-${id}.webp`,
  chore: (id: ChoreSticker) => (id === "star" ? "art/stk-star.webp" : `art/chore-${id}.webp`),
  bear: (outfit: BearOutfit | "party") => `art/polarbear-${BEAR_ART[outfit]}.webp`,
  raincloud: "art/raincloud.webp",
  sky: (sky: Sky | "night") => `art/wx-${SKY_ART[sky]}.webp`,
  /** A friendly animal for each column colour (theme, not identity). */
  mascot: (color: KidColor) => `art/${MASCOTS[color]}.webp`,
};

const SKY_ART: Record<Sky | "night", string> = {
  sunny: "sunny",
  partly: "partly",
  cloudy: "cloudy",
  foggy: "foggy",
  rainy: "rainy",
  snowy: "snowy",
  stormy: "stormy",
  night: "night",
};

const MASCOTS: Record<KidColor, string> = {
  pink: "axolotl",
  blue: "seal",
  purple: "polarbear-party",
  green: "axolotl",
  orange: "seal",
};

// Snow and cool days reuse the winter coat until they get their own outfits.
const BEAR_ART: Record<BearOutfit | "party", string> = {
  rain: "rain",
  snow: "cold",
  cold: "cold",
  cool: "cold",
  sun: "sun",
  party: "party",
};
