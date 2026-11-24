import type { DashboardBundle } from "@kids-dash/core";
import { z } from "zod";
import type { FrameStatus } from "../bridge";
import { clockFace } from "../format";
import { html, type Raw } from "../html";

/** What the shell reports about itself (KidsDashNative.deviceInfo). */
export const DeviceInfo = z.object({
  versionName: z.string().optional(),
  versionCode: z.number().optional(),
  autoUpdates: z.boolean().optional(),
  network: z.string().nullable().optional(),
  ip: z.string().nullable().optional(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

/** Small and quiet beside the date: settings are for grown-ups. */
export function gearButton(): Raw {
  return html`<button type="button" class="gear-button" data-action="settings" aria-label="Frame settings">
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)"/></svg>
  </button>`;
}

/** The ⚙ panel: which frame this is, its app, its network, and a way to change Wi-Fi. */
export function settingsSheet(
  bundle: DashboardBundle,
  info: DeviceInfo,
  status: FrameStatus,
  canChangeWifi: boolean,
): Raw {
  const updated = status.updatedAt ? clockFace(new Date(status.updatedAt), bundle.timezone) : null;
  const row = (label: string, value: string, extra: Raw | string = "") =>
    html`<div class="settings-row"><span class="settings-label">${label}</span><span class="settings-value">${value}</span>${extra}</div>`;
  const network = info.network ?? (info.ip ? "Connected" : "Not connected");
  return html`<div class="sheet-card settings-sheet" role="dialog" aria-label="Frame settings">
    <h2 class="sheet-title">${bundle.device?.name ?? "This frame"}</h2>
    <div class="settings-rows">
      ${row(
        "Wi-Fi",
        info.ip ? `${network} · ${info.ip}` : network,
        canChangeWifi
          ? html`<button type="button" class="nav-button dark settings-action" data-action="wifi">Change Wi-Fi</button>`
          : "",
      )}
      ${row(
        "Dashboard",
        status.online
          ? updated
            ? `Up to date · ${updated.time} ${updated.period}`
            : "Up to date"
          : updated
            ? `Offline since ${updated.time} ${updated.period}`
            : "Offline",
      )}
      ${row("Photos", bundle.slides.length ? `${bundle.slides.length} in the slideshow` : "No photos yet")}
      ${row(
        "App",
        info.versionName
          ? `${info.versionName} · ${info.autoUpdates ? "updates itself" : "updated by hand"}`
          : "Unknown",
      )}
    </div>
    <span class="sheet-close">Tap anywhere to close</span>
  </div>`;
}
