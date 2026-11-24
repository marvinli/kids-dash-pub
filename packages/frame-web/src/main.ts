import { App, TICK_MS } from "./app";
import type { NativeBridge } from "./bridge";

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/**
 * Laid out for the frame's 1920×1080 at 1:1. Anywhere else (a laptop browser
 * during development) the stage is scaled to fit, once per resize, with a
 * single transform.
 */
export function fitStage(stage: HTMLElement, width: number, height: number): number {
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  stage.style.transform = scale === 1 ? "" : `scale(${scale})`;
  return scale;
}

export function boot(native: NativeBridge, root: HTMLElement, now?: () => Date): App {
  const app = new App({ root, native, ...(now ? { now } : {}) });
  window.kidsDash = app;
  const resize = () => fitStage(root, window.innerWidth, window.innerHeight);
  resize();
  window.addEventListener("resize", resize);
  window.setInterval(() => app.tick(), TICK_MS);
  native.ready();
  return app;
}

const root = document.getElementById("app");
if (root && window.KidsDashNative) boot(window.KidsDashNative, root);
