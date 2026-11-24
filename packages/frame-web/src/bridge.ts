/**
 * The contract between this page and the Android shell (packages/frame-android,
 * MainActivity/WebBridge). The page has no network access: the shell fetches and
 * verifies everything and pushes it in; the page reports taps back out.
 */

/** Exposed by the shell as `window.KidsDashNative` (@JavascriptInterface). */
export interface NativeBridge {
  /** The page is ready for render(); the shell answers with its cached bundle. */
  ready(): void;
  /** A kid tapped a chore. The shell saves it, then calls choreSaved/choreFailed. */
  setChore(kidId: string, choreId: string, date: string, done: boolean): void;
  /** Show the photo slideshow now. Absent in older shells. */
  showPhotos?(): void;
  /** JSON facts for the settings panel (version, network). Absent in older shells. */
  deviceInfo?(): string;
  /** Open Android's Wi-Fi settings; the shell brings the dashboard back. */
  openWifiSettings?(): void;
  /** Save an event added on the week screen; answered by eventSaved/eventFailed. */
  addEvent?(requestId: string, json: string): void;
  /** Save an edited calendar event (core FrameEventEdit); answered by eventSaved/eventFailed. */
  editEvent?(requestId: string, eventId: string, json: string): void;
  /** Delete a calendar event, "one" day or "all" of a repeating one; answered by eventSaved/eventFailed. */
  deleteEvent?(requestId: string, eventId: string, scope: string): void;
  /** The power button: black the screen out as at night until the next touch. */
  sleepNow?(): void;
  /** Save a chore added on the Chores screen; answered by choreAdded/choreAddFailed. */
  addChore?(requestId: string, json: string): void;
}

/** Status the shell reports about its connection to the API. */
export interface FrameStatus {
  online: boolean;
  /** ISO time the shown bundle was fetched; null before any fetch. */
  updatedAt: string | null;
}

/** Installed by the page as `window.kidsDash`; the shell calls these. */
export interface FrameApi {
  /** A signature-verified bundle payload (UTF-8 JSON). */
  render(bundleJson: string): void;
  /** `{ [kidId]: "data:image/...;base64,..." }`, each checked against its sha256. */
  setPhotos(photosJson: string): void;
  /** JSON array of the art file names the frame has (shells before v146 never call it). */
  setArt(namesJson: string): void;
  /** The check-off for `date` (shells before v130 leave it out: today) was saved or failed. */
  choreSaved(kidId: string, choreId: string, date?: string): void;
  choreFailed(kidId: string, choreId: string, date?: string): void;
  setStatus(statusJson: string): void;
  eventSaved(requestId: string, eventId: string): void;
  /**
   * `reason`: "invalid" (the server found the form bad), "refused" (the server
   * or Google would not make the change) or "offline".
   */
  eventFailed(requestId: string, reason: string): void;
  /** `choreJson`: the saved chore as the server returned it. */
  choreAdded(requestId: string, choreJson: string): void;
  /** `reason` as for eventFailed. */
  choreAddFailed(requestId: string, reason: string): void;
}

declare global {
  interface Window {
    KidsDashNative?: NativeBridge;
    kidsDash?: FrameApi;
  }
}
