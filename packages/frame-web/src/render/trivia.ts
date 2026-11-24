import type { TriviaQuestion } from "@kids-dash/core";
import { html, type Raw } from "../html";
import { art } from "../theme";

/** The licence (CC BY-NC 4.0) asks for a credit. */
export const TRIVIA_CREDIT = "Questions from The Trivia API (the-trivia-api.com)";

/**
 * Today's trivia, played as a team: a question and its answers; a tap picks
 * one and shows the right answer; then the next question, and at the end the
 * score. `picks` holds the answer picked for each question (null: not yet).
 */
export function triviaSheet(
  questions: readonly TriviaQuestion[],
  at: number,
  picks: readonly (number | null)[],
): Raw {
  const q = questions[at];
  if (!q) return html``;
  const picked = picks[at] ?? null;
  const answered = picked !== null;
  const right = picked === q.correct;
  const last = at >= questions.length - 1;
  const score = questions.filter((x, i) => picks[i] === x.correct).length;
  return html`<div class="sheet-card trivia-sheet" role="dialog" aria-label="Trivia" data-action="noop">
    <div class="joke-top">
      <span class="joke-tag">TRIVIA · ${at + 1} OF ${questions.length}</span>
      <span class="trivia-category">${q.category}</span>
      <button type="button" class="joke-close" data-action="close-sheet" aria-label="Close">
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
      </button>
    </div>
    <p class="trivia-question">${q.question}</p>
    <div class="trivia-answers">${q.answers.map((answer, i) => {
      const state = !answered
        ? ""
        : i === q.correct
          ? " is-right"
          : i === picked
            ? " is-picked"
            : " is-other";
      return html`<button type="button" class="trivia-answer${state}" data-action="trivia-answer" data-index="${String(i)}"${answered ? html` disabled` : ""}>
        <span class="trivia-letter">${"ABCDEF"[i] ?? ""}</span><span class="trivia-text">${answer}</span>
      </button>`;
    })}</div>
    ${
      answered
        ? html`<div class="trivia-result">
            <img class="trivia-bear${right ? " hop" : ""}" src="${art.bear(right ? "party" : "sun")}" alt="" width="120" height="120">
            <span class="trivia-verdict">${right ? "You got it!" : html`Not quite! It's <strong>${q.answers[q.correct] ?? ""}</strong>.`}</span>
            ${
              last
                ? html`<span class="trivia-score">${score} of ${questions.length}${score === questions.length ? ", perfect!" : score ? ", nice!" : ". New ones tomorrow!"}</span>
                  <button type="button" class="nav-button header-button" data-action="close-sheet">Done</button>`
                : html`<button type="button" class="joke-next" data-action="trivia-next">Next question</button>`
            }
          </div>`
        : ""
    }
    <span class="trivia-credit">${TRIVIA_CREDIT}</span>
  </div>`;
}
