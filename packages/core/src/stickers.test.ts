import { describe, expect, it } from "vitest";
import { defaultBadge, inferChoreSticker, inferEventSticker } from "./stickers";

describe("inferEventSticker", () => {
  it.each([
    ["Field trip to the Science Museum", "museum"],
    ["Field trip to the farm", "bus"],
    ["Zoo trip", "bus"],
    ["NO SCHOOL – teacher planning", "school"],
    ["Grandma's birthday party", "cake"],
    ["Playdate with Noa", "house"],
    ["A friend comes over", "house"],
    ["Soccer game", "soccer"],
    ["Ballet", "ballet"],
    ["Art club", "palette"],
    ["Dentist", "star"],
    // The family's real calendar titles.
    ["Religious School", "star-of-david"],
    ["Hebrew class", "star-of-david"],
    ["Book Making", "book"],
    ["Woodworking", "woodworking"],
    ["Tae Kwon-Do", "taekwondo"],
    ["Taekwondo belt test", "taekwondo"],
    ["Flute lesson", "music"],
    ["Dungeons & Dragons", "dice"],
    ["Miniature Makers", "palette"],
    ["Gingerbread decorating", "gingerbread"],
    ["Food pantry drive", "soup"],
    ["Food drive: bring cans", "soup"],
    ["Road trip to Connecticut", "car"],
    ["Li Family Thanksgiving", "turkey"],
    ["Thanksgiving break", "turkey"],
    ["Thanksgiving Assembly", "microphone"],
    ["Winter Program", "microphone"],
    ["Winter break", "school"],
    ["Parent conferences", "school"],
    ["Lenape Museum", "museum"],
    ["Dinner with Auntie Clarissa", "dinner"],
    ["Mosaic interview due", "pencil"],
    ["Math Morning (2H)", "pencil"],
    ["Field Day", "medal"],
    ["Moving Up Day", "medal"],
  ])("%s → %s", (title, sticker) => {
    expect(inferEventSticker(title)).toBe(sticker);
  });

  it("matches whole words only", () => {
    expect(inferEventSticker("Smart board demo")).toBe("star");
  });
});

describe("defaultBadge", () => {
  it("names well-known specials and falls back to Special", () => {
    expect(defaultBadge("bus")).toBe("Field trip");
    expect(defaultBadge("school")).toBe("No school");
    expect(defaultBadge("soccer")).toBe("Special");
    expect(defaultBadge("turkey")).toBe("Thanksgiving");
    expect(defaultBadge("pencil")).toBe("Due");
  });
});

describe("inferChoreSticker", () => {
  it.each([
    ["Make your bed", "bed"],
    ["Brush teeth", "teeth"],
    ["Get dressed", "dress"],
    ["Put PJs on", "dress"],
    ["Pack your backpack", "bag"],
    ["Feed the fish", "fish"],
    ["Tidy living room", "toys"],
    ["Clear the table", "table"],
    ["Water the plants", "plants"],
    ["Practice piano", "star"],
  ] as const)("%s → %s", (title, sticker) => {
    expect(inferChoreSticker(title)).toBe(sticker);
  });
});
