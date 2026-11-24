import type { NativeBridge } from "./bridge";
import { boot } from "./main";
import { sampleBundle } from "./test-bundle";

/**
 * Desktop preview (`pnpm dev`, then open dist-dev/index.html): a stand-in for
 * the Android shell that serves the sample bundle and acknowledges taps.
 */
// ?bundle=<file.js> previews a real bundle: the file (served next to
// index.html) sets `window.devBundle`. A script, because the page's CSP (the
// frame's) forbids fetch.
const params = new URLSearchParams(location.search);
const bundleFile = params.get("bundle");
// ?now=<ISO instant> freezes the clock (the sample bundle is built for it too),
// e.g. ?now=2026-12-24T23:30:00Z to see a holiday backdrop at night.
const frozen = params.get("now");
const fixedNow = frozen ? new Date(frozen) : undefined;

const native: NativeBridge = {
  ready: () => {
    if (!bundleFile) {
      window.kidsDash?.render(JSON.stringify(sampleBundle(fixedNow ? { now: fixedNow } : {})));
      return;
    }
    const script = document.createElement("script");
    script.src = bundleFile;
    script.onload = () => {
      window.kidsDash?.render(JSON.stringify((window as { devBundle?: unknown }).devBundle));
      openFromHash();
    };
    document.head.append(script);
  },
  setChore: (kidId, choreId, date) =>
    setTimeout(() => window.kidsDash?.choreSaved(kidId, choreId, date), 300),
  sleepNow: () => console.info("sleepNow"),
  addChore: (requestId, json) =>
    setTimeout(() => window.kidsDash?.choreAdded(requestId, json), 500),
};

const root = document.getElementById("app");
if (root) {
  boot(native, root, fixedNow ? () => fixedNow : undefined);
  if (!bundleFile) openFromHash();
}

/**
 * index.html#week or #chores opens that screen, for screenshots;
 * #chores=2026-11-17 opens the Chores screen on that day; #joke opens the
 * joke and #joke=reveal shows its punchline; #trivia, #history and #place
 * open theirs. With ?bundle=, this waits for that bundle to load.
 */
function openFromHash(): void {
  const root = document.getElementById("app");
  if (!root) return;
  const [screen, date] = location.hash.slice(1).split("=");
  const target =
    screen === "chores"
      ? `[data-action="chores"]${date ? `[data-date="${date}"]` : ""}`
      : `[data-action="go"][data-screen="${screen}"]`;
  if (screen === "history" || screen === "place") {
    root.querySelector<HTMLElement>(`[data-action="${screen}"]`)?.click();
  } else if (screen === "trivia") {
    root.querySelector<HTMLElement>('[data-action="trivia"]')?.click();
    // #trivia=1 answers the first question with the second answer.
    if (date)
      root
        .querySelector<HTMLElement>(`[data-action="trivia-answer"][data-index="${date}"]`)
        ?.click();
  } else if (screen === "joke") {
    root.querySelector<HTMLElement>('[data-action="joke"]')?.click();
    if (date === "reveal") root.querySelector<HTMLElement>('[data-action="joke-reveal"]')?.click();
  } else {
    root.querySelector<HTMLElement>(target)?.click();
  }
}
