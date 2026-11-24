import {
  assembleBundle,
  Chore,
  type DashboardBundle,
  type Note,
  type SampleEventInput,
  Settings,
  sampleEvent,
} from "@kids-dash/core";

/**
 * An example family bundle for tests and the desktop preview (`pnpm dev`). Never
 * shipped to the frame: the production build only includes main.ts.
 */
export const SAMPLE_NOW = new Date("2026-11-16T12:42:00Z");

export function sampleBundle(overrides: { now?: Date; done?: string[] } = {}): DashboardBundle {
  const settings = Settings.parse({
    timezone: "America/New_York",
    location: { name: "Home", latitude: 40.7, longitude: -74 },
    kids: [
      { id: "maya", name: "Maya", color: "pink" },
      { id: "theo", name: "Theo", color: "blue" },
    ],
  });
  const maya = { kind: "kid", kidId: "maya" } as const;
  const theo = { kind: "kid", kidId: "theo" } as const;
  const everyone = { kind: "everyone" } as const;
  let n = 0;
  const ev = (input: SampleEventInput) => sampleEvent(`e${++n}`, input);
  const events = [
    ev({
      owner: maya,
      title: "Science Museum",
      date: "2026-11-16",
      time: "09:00",
      special: true,
      badge: "Field trip",
      note: "Sneakers on · packed lunch",
      details: "The bus leaves at 9.\nYou will see the dinosaurs!",
    }),
    ev({
      owner: maya,
      title: "Ballet",
      date: "2026-11-16",
      time: "16:30",
      note: "Leotard is in your bag",
    }),
    ev({
      owner: theo,
      title: "A friend comes over",
      date: "2026-11-16",
      time: "16:30",
      special: true,
      note: "After art club",
    }),
    ev({
      owner: theo,
      title: "Art club",
      date: "2026-11-16",
      time: "15:15",
      note: "Wear your paint smock",
    }),
    ev({ owner: theo, title: "Soccer practice", date: "2026-11-17", time: "16:00" }),
    ev({ owner: everyone, title: "No school", date: "2026-11-18" }),
    ev({ owner: everyone, title: "Pajama day", date: "2026-11-19", special: true }),
    ev({
      owner: theo,
      title: "Soccer game",
      date: "2026-11-20",
      time: "17:00",
      special: true,
      details: "Wear your blue jersey.",
    }),
    ev({
      owner: everyone,
      title: "Grandma's birthday",
      date: "2026-11-21",
      time: "14:00",
      special: true,
    }),
    ev({ owner: everyone, title: "Pancake breakfast", date: "2026-11-22", time: "09:00" }),
  ];
  const chore = (kidId: string, id: string, title: string, sticker: string, period = "morning") =>
    Chore.parse({ kidId, id, title, sticker, period });
  const chores = [
    chore("maya", "bed", "Make your bed", "bed"),
    chore("maya", "teeth", "Brush teeth", "teeth"),
    chore("maya", "dress", "Get dressed", "dress"),
    chore("maya", "bag", "Pack backpack", "bag"),
    chore("maya", "fish", "Feed the fish", "fish", "afterSchool"),
    chore("maya", "table", "Set the table", "table", "afterSchool"),
    chore("theo", "bed", "Make your bed", "bed"),
    chore("theo", "teeth", "Brush teeth", "teeth"),
    chore("theo", "dress", "Get dressed", "dress"),
    chore("theo", "bag", "Pack backpack", "bag"),
    chore("theo", "toys", "Put toys away", "toys", "afterSchool"),
    chore("theo", "plants", "Water plants", "plants", "afterSchool"),
  ];
  const notes: Note[] = [
    { id: "book", date: "2026-11-16", owner: maya, text: "Library book goes back today" },
    { id: "folder", date: "2026-11-16", owner: theo, text: "Bring your green folder" },
  ];
  return assembleBundle({
    now: overrides.now ?? SAMPLE_NOW,
    settings,
    events,
    weather: {
      high: 52,
      low: 41,
      rainChance: 80,
      code: 61,
      current: null,
      sunrise: null,
      sunset: null,
    },
    chores,
    notes,
    completed: new Set(overrides.done ?? ["maya/bed", "maya/teeth", "maya/dress", "theo/teeth"]),
    onThisDay: [
      { year: 1928, text: "Mickey Mouse first appeared on screen.", image: null },
      { year: 1991, text: "Uzbekistan adopted its flag.", image: null },
      { year: 2011, text: "The video game Minecraft left beta.", image: null },
    ],
    place: {
      kind: "state",
      name: "Vermont",
      where: null,
      map: null,
      facts: [
        { label: "Capital", value: "Montpelier" },
        { label: "People", value: "643,077" },
      ],
      blurb: "Vermont is a landlocked state in New England. It is known for maple syrup.",
    },
    trivia: [
      {
        id: "t1",
        category: "Science",
        question: "What is a baby seal called?",
        answers: ["A kit", "A pup", "A calf", "A cub"],
        correct: 1,
      },
      {
        id: "t2",
        category: "Geography",
        question: "Which of these countries borders Mexico?",
        answers: ["Canada", "Peru", "United States of America", "Cuba"],
        correct: 2,
      },
      {
        id: "t3",
        category: "Science",
        question: "Cirrus and cumulus are types of what?",
        answers: ["Cloud", "Rock", "Tree", "Fish"],
        correct: 0,
      },
    ],
  });
}
