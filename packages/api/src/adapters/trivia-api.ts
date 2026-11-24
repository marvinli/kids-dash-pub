import type { TriviaQuestion } from "@kids-dash/core";
import { z } from "zod";
import type { TriviaReader } from "../services/ports";

const QUESTIONS_URL = "https://the-trivia-api.com/v2/questions";

/**
 * The categories asked for, with the label the frame shows. Left out: sport
 * (mostly US pro-team minutiae), society and culture (brand slogans, internet
 * slang), film, music and arts (grown-up pop culture).
 */
export const TRIVIA_CATEGORIES: Record<string, string> = {
  science: "Science",
  geography: "Geography",
  food_and_drink: "Food",
  general_knowledge: "General knowledge",
  history: "History",
};

/**
 * A second guard behind the API's family filter: words that have no place in
 * a kids' quiz. Matched as whole words, case-insensitive.
 */
const BLOCKED =
  /\b(alcohol\w*|beer|wine|vodka|whisk(?:e)?y|gin|rum|tequila|liquor|cocktail\w*|drunk\w*|sex\w*|murder\w*|kill\w*|drug\w*|cigar\w*|tobacco|wtf)\b/i;

const ApiQuestion = z.object({
  id: z.string(),
  category: z.string(),
  correctAnswer: z.string(),
  incorrectAnswers: z.array(z.string()),
  question: z.object({ text: z.string() }),
  isNiche: z.boolean().optional(),
});

/**
 * The Trivia API (the-trivia-api.com): keyless for English multiple choice,
 * free for non-commercial use under CC BY-NC 4.0 (the frame credits it).
 * Family-filtered, easy and medium, no niche questions.
 */
export class TheTriviaApiReader implements TriviaReader {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly random: () => number = Math.random,
  ) {}

  async questions(count: number): Promise<TriviaQuestion[]> {
    const params = new URLSearchParams({
      limit: String(Math.min(50, Math.max(1, count))),
      categories: Object.keys(TRIVIA_CATEGORIES).join(","),
      difficulties: "easy,medium",
      types: "text_choice",
      region: "US",
      contentFilter: "family",
    });
    const response = await this.fetchFn(`${QUESTIONS_URL}?${params}`);
    if (!response.ok) throw new Error(`The Trivia API answered ${response.status}`);
    const raw = z.array(z.unknown()).parse(await response.json());
    return raw.flatMap((item) => {
      const parsed = ApiQuestion.safeParse(item);
      if (!parsed.success) return [];
      const q = parsed.data;
      const answers = [q.correctAnswer, ...q.incorrectAnswers];
      if (q.isNiche || answers.length < 2 || answers.length > 6) return [];
      if ([q.question.text, ...answers].some((text) => BLOCKED.test(text))) return [];
      const order = this.shuffled(answers);
      return [
        {
          id: q.id,
          category: TRIVIA_CATEGORIES[q.category] ?? "Trivia",
          question: q.question.text.trim(),
          answers: order.map((a) => a.trim()),
          correct: order.indexOf(q.correctAnswer),
        },
      ];
    });
  }

  private shuffled(list: string[]): string[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j] as string, out[i] as string];
    }
    return out;
  }
}
