import { z } from "zod";

/**
 * Sticker art the frame ships (assets/art/web/stk-<id>.webp and chore-<id>.webp).
 * Ids are part of the bundle contract: adding one means adding its art.
 */
export const EVENT_STICKERS = [
  "bus",
  "soccer",
  "palette",
  "house",
  "school",
  "cake",
  "ballet",
  "star",
  "star-of-david",
  "book",
  "woodworking",
  "taekwondo",
  "music",
  "dice",
  "gingerbread",
  "soup",
  "car",
  "turkey",
  "museum",
  "dinner",
  "pencil",
  "microphone",
  "medal",
  "gift",
] as const;
export const EventSticker = z.enum(EVENT_STICKERS);
export type EventSticker = z.infer<typeof EventSticker>;

export const CHORE_STICKERS = [
  "bed",
  "teeth",
  "dress",
  "bag",
  "fish",
  "toys",
  "table",
  "plants",
  "star",
] as const;
export const ChoreSticker = z.enum(CHORE_STICKERS);
export type ChoreSticker = z.infer<typeof ChoreSticker>;

// First match wins, so more specific phrases come before general ones:
// "Thanksgiving Assembly" is a show, "Thanksgiving break" is turkey, "Religious
// School" is not a no-school day, a belt test is taekwondo, not homework.
const EVENT_KEYWORDS: ReadonlyArray<readonly [RegExp, EventSticker]> = [
  [
    /\bassembly\b|\bconcert\b|\brecital\b|\bperformance\b|\bwinter program\b|\bfestival\b|\bshow\b/i,
    "microphone",
  ],
  [/\bthanksgiving\b|\bturkey\b/i, "turkey"],
  [
    /\breligious school\b|\bhebrew\b|\bshabbat\b|\btemple\b|\bsynagogue\b|\btorah\b|\b(?:c?h)?anukk?ah\b|\bpassover\b|\bseder\b/i,
    "star-of-david",
  ],
  [
    /\bno school\b|\bday off\b|\bteacher (?:planning|workday)|\bholiday\b|\bbreak\b|\brecess\b|\blong weekend\b|\bconferences?\b/i,
    "school",
  ],
  [/\bgingerbread\b/i, "gingerbread"],
  [/\bfood (?:pantry|drive)\b|\bpantry\b|\bsoup\b|\bcans?\b/i, "soup"],
  [/\bmuseum\b/i, "museum"],
  [/\bfield ?trip\b|\bzoo\b|\baquarium\b|\bexcursion\b/i, "bus"],
  [/\broad ?trip\b|\bdrive to\b|\btrip to\b|\bflight\b|\btravel/i, "car"],
  [/\btae ?kwon|\btaekwondo\b|\bkarate\b|\bmartial arts\b|\bbelt\b|\bdojo\b/i, "taekwondo"],
  [/\bbirthday\b|\bparty\b|\bcelebrat/i, "cake"],
  [/\bgifts?\b|\bpresents?\b/i, "gift"],
  [/\bplay ?date\b|\bsleepover\b|\bcomes? over\b/i, "house"],
  [/\bsoccer\b|\bfootball\b/i, "soccer"],
  [
    /\bfield day\b|\bmoving up\b|\bgraduation\b|\baward|\bmedal\b|\btournament\b|\brace\b/i,
    "medal",
  ],
  [
    /\bflute\b|\bpiano\b|\bviolin\b|\bcello\b|\bguitar\b|\bdrums?\b|\bchoir\b|\bmusic\b|\brecorder\b/i,
    "music",
  ],
  [/\bdungeons\b|\bd&d\b|\bboard games?\b|\bchess\b/i, "dice"],
  [/\bwood ?work|\bcarpentry\b|\blego\b|\brobotics?\b/i, "woodworking"],
  [/\bbooks?\b|\breading\b|\blibrary\b|\bstory ?time\b/i, "book"],
  [/\bdinner\b|\blunch\b|\bbrunch\b|\bbreakfast\b/i, "dinner"],
  [/\bdue\b|\bhomework\b|\bproject\b|\binterview\b|\bmath\b|\bquiz\b|\btest\b/i, "pencil"],
  [/\bballet\b|\bdance\b/i, "ballet"],
  [/\bart\b|\bpaint|\bdraw|\bcraft|\bmakers?\b|\bminiature/i, "palette"],
];

/** Best sticker for an event title; `star` when nothing matches. */
export function inferEventSticker(title: string): EventSticker {
  for (const [pattern, sticker] of EVENT_KEYWORDS) {
    if (pattern.test(title)) return sticker;
  }
  return "star";
}

const CHORE_KEYWORDS: ReadonlyArray<readonly [RegExp, ChoreSticker]> = [
  [/\bbeds?\b/i, "bed"],
  [/\bteeth\b|\btooth\b|\bbrush\b|\bfloss/i, "teeth"],
  [/\bdress|\bclothes\b|\bpajamas\b|\bpjs\b|\blaundry\b|\bsocks\b|\bshoes\b/i, "dress"],
  [/\bbag\b|\bbackpack\b|\bpack\b|\blunch\s?box\b|\bhomework\b|\bfolder\b/i, "bag"],
  [/\bfish\b|\bpets?\b|\bfeed\b|\bdog\b|\bcat\b|\bhamster\b/i, "fish"],
  [/\btoys?\b|\btidy\b|\bclean\b|\bpick up\b|\bput away\b|\broom\b/i, "toys"],
  [/\btable\b|\bdish(?:es)?\b|\bplates?\b|\bdishwasher\b|\bclear\b/i, "table"],
  [/\bplants?\b|\bwater\b|\bgarden\b|\bflowers?\b/i, "plants"],
];

/** A chore sticker guessed from its title ("Brush teeth" → teeth); star otherwise. */
export function inferChoreSticker(title: string): ChoreSticker {
  for (const [pattern, sticker] of CHORE_KEYWORDS) {
    if (pattern.test(title)) return sticker;
  }
  return "star";
}

const DEFAULT_BADGES: Partial<Record<EventSticker, string>> = {
  bus: "Field trip",
  museum: "Field trip",
  house: "Playdate",
  cake: "Celebration",
  gift: "Celebration",
  school: "No school",
  turkey: "Thanksgiving",
  car: "Road trip",
  soup: "Bring",
  pencil: "Due",
  medal: "Big day",
  microphone: "Show",
  taekwondo: "Big day",
};

/** Label for a pinned special when the calendar did not name one. */
export function defaultBadge(sticker: EventSticker): string {
  return DEFAULT_BADGES[sticker] ?? "Special";
}
