import { html, type Raw } from "../html";
import type { Joke } from "../jokes";
import { art } from "../theme";

/**
 * The day's joke: the setup, then the punchline behind "Tell me!". After
 * the joke of the day come the bonus ones, then "more tomorrow".
 */
export function jokeSheet(jokes: readonly Joke[], at: number, revealed: boolean): Raw {
  const joke = jokes[at];
  if (!joke) return html``;
  const last = at >= jokes.length - 1;
  const tag = at === 0 ? "JOKE OF THE DAY" : `BONUS JOKE ${at} OF ${jokes.length - 1}`;
  return html`<div class="sheet-card joke-sheet" role="dialog" aria-label="Joke of the day" data-action="noop">
    <div class="joke-top">
      <span class="joke-tag">${tag}</span>
      <button type="button" class="joke-close" data-action="close-sheet" aria-label="Close">
        <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="joke-body">
      <img class="joke-bear${revealed ? " hop" : " bob"}" src="${art.bear(revealed ? "party" : "sun")}" alt="" width="260" height="260">
      <div class="joke-text">
        <p class="joke-setup">${joke.setup}</p>
        ${
          revealed
            ? html`<p class="joke-punch">${joke.punchline}</p><span class="joke-drum">Ba-dum-tss!</span>`
            : html`<button type="button" class="joke-reveal" data-action="joke-reveal">Tell me!</button>`
        }
      </div>
    </div>
    ${
      revealed
        ? html`<div class="joke-foot">${
            last
              ? html`<span class="joke-done">That's all the jokes for today. More tomorrow!</span><button type="button" class="nav-button header-button" data-action="close-sheet">Done</button>`
              : html`<button type="button" class="joke-next" data-action="joke-next">Another one!</button>`
          }</div>`
        : ""
    }
  </div>`;
}
