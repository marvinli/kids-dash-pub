import { describe, expect, it, vi } from "vitest";
import { TheTriviaApiReader } from "./trivia-api";

const q = (id: string, text: string, correct: string, wrong: string[], extra = {}) => ({
  id,
  category: "science",
  correctAnswer: correct,
  incorrectAnswers: wrong,
  question: { text },
  isNiche: false,
  ...extra,
});

function reader(body: unknown, ok = true) {
  const fetchFn = vi.fn(
    async (_url: string) => new Response(JSON.stringify(body), { status: ok ? 200 : 503 }),
  );
  // Always swap with the first: a fixed, checkable shuffle.
  return { fetchFn, reader: new TheTriviaApiReader(fetchFn as unknown as typeof fetch, () => 0) };
}

describe("TheTriviaApiReader", () => {
  it("asks for family-safe easy and medium questions in kid-friendly categories", async () => {
    const { fetchFn, reader: r } = reader([]);
    await r.questions(20);
    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://the-trivia-api.com/v2/questions");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      limit: "20",
      difficulties: "easy,medium",
      types: "text_choice",
      contentFilter: "family",
    });
    expect(url.searchParams.get("categories")?.split(",")).toEqual([
      "science",
      "geography",
      "food_and_drink",
      "general_knowledge",
      "history",
    ]);
  });

  it("shuffles the answers, remembers the right one, and labels the category", async () => {
    const { reader: r } = reader([
      q("a", " What is a baby seal called? ", "A pup", ["A kit", "A calf", "A cub"]),
    ]);
    const [question] = await r.questions(3);
    expect(question).toEqual({
      id: "a",
      category: "Science",
      question: "What is a baby seal called?",
      answers: ["A kit", "A calf", "A cub", "A pup"],
      correct: 3,
    });
  });

  it("drops niche, malformed and unsuitable questions", async () => {
    const { reader: r } = reader([
      q("niche", "Who?", "X", ["Y"], { isNiche: true }),
      q("beer", "Which country brews this beer?", "Germany", ["Peru"]),
      q("gin", "Where is gin popular?", "England", ["Peru"]),
      q("lonely", "Only one answer?", "Yes", []),
      { id: "broken" },
      q("ok", "Which camel has two humps?", "Bactrian", ["Dromedary"], { category: "odd" }),
    ]);
    const questions = await r.questions(10);
    expect(questions.map((x) => x.id)).toEqual(["ok"]);
    expect(questions[0]?.category).toBe("Trivia");
  });

  it("fails loudly when the API does", async () => {
    await expect(reader({}, false).reader.questions(3)).rejects.toThrow("503");
  });
});
