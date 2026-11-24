import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CalendarRefusedError, GoogleNotConfiguredError } from "../services/ports";
import { GoogleAuth, signedAssertion } from "./google-auth";
import {
  GoogleCalendarReader,
  GoogleCalendarWriter,
  offsetDateTime,
  toEntry,
  zonedInstant,
} from "./google-calendar";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ACCOUNT = {
  client_email: "kids-dash@project.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const NOW = Date.parse("2026-11-16T12:00:00Z");

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeGoogle(pages: unknown[]) {
  const queue = [...pages];
  return vi.fn(async (url: string | URL | Request) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return reply({ access_token: "tok", expires_in: 3600 });
    }
    return reply(queue.shift());
  });
}

const calendar = (
  credentials: () => Promise<string | null>,
  fetchFn: typeof fetch,
  now?: () => number,
) => new GoogleCalendarReader(new GoogleAuth(credentials, fetchFn, now), fetchFn);

describe("GoogleCalendarReader", () => {
  it("reports missing or placeholder credentials as not configured", async () => {
    for (const secret of [null, "random-placeholder", '{"client_email":"x"}']) {
      const reader = calendar(async () => secret, vi.fn());
      await expect(
        reader.listEntries("c", "2026-11-15", "2026-11-24", "UTC"),
      ).rejects.toBeInstanceOf(GoogleNotConfiguredError);
    }
  });

  it("exchanges a signed JWT, pages through events and normalizes them", async () => {
    const fetchFn = fakeGoogle([
      {
        items: [
          {
            id: "a",
            summary: "Field trip",
            description: "Lunch",
            start: { dateTime: "2026-11-16T09:00:00-05:00" },
            end: { dateTime: "2026-11-16T14:00:00-05:00" },
          },
        ],
        nextPageToken: "p2",
      },
      {
        items: [
          { id: "b", start: { date: "2026-11-18" }, end: { date: "2026-11-19" } },
          {
            id: "c",
            status: "cancelled",
            start: { date: "2026-11-18" },
            end: { date: "2026-11-19" },
          },
        ],
      },
    ]);
    const reader = calendar(
      async () => JSON.stringify(ACCOUNT),
      fetchFn,
      () => NOW,
    );

    const entries = await reader.listEntries(
      "kid@group.calendar.google.com",
      "2026-11-15",
      "2026-11-24",
      "America/New_York",
    );

    expect(entries).toEqual([
      {
        id: "a",
        title: "Field trip",
        description: "Lunch",
        start: { date: "2026-11-16", time: "09:00" },
        end: { date: "2026-11-16", time: "14:00" },
        allDay: false,
      },
      {
        id: "b",
        title: "",
        description: null,
        start: { date: "2026-11-18", time: null },
        end: { date: "2026-11-19", time: null },
        allDay: true,
      },
    ]);
    const urls = fetchFn.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls[1]?.pathname).toBe("/calendar/v3/calendars/kid%40group.calendar.google.com/events");
    expect(urls[1]?.searchParams.get("timeZone")).toBe("America/New_York");
    expect(urls[1]?.searchParams.get("singleEvents")).toBe("true");
    expect(urls[2]?.searchParams.get("pageToken")).toBe("p2");

    // The access token is cached across calls until near expiry.
    fetchFn.mockClear();
    fetchFn.mockResolvedValueOnce(reply({ items: [] }));
    await reader.listEntries("x", "2026-11-15", "2026-11-24", "UTC");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("surfaces Google errors", async () => {
    const tokenFail = vi.fn(async () => reply({}, 401));
    await expect(
      calendar(async () => JSON.stringify(ACCOUNT), tokenFail).listEntries(
        "c",
        "2026-11-15",
        "2026-11-24",
        "UTC",
      ),
    ).rejects.toThrow(/token endpoint answered 401/);

    const listFail = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2")
        ? reply({ access_token: "t", expires_in: 3600 })
        : reply({}, 404),
    );
    await expect(
      calendar(async () => JSON.stringify(ACCOUNT), listFail).listEntries(
        "c",
        "2026-11-15",
        "2026-11-24",
        "UTC",
      ),
    ).rejects.toThrow(/answered 404/);
  });
});

describe("GoogleCalendarWriter", () => {
  const event = {
    title: "Soccer",
    description: "kids:\nAdded on the Kitchen frame.",
    date: "2026-11-16",
    time: "16:30",
    durationMinutes: 60,
    timeZone: "America/New_York",
  };

  function writer(answer: () => Response = () => reply({ id: "evt123" })) {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("oauth2") ? reply({ access_token: "tok", expires_in: 3600 }) : answer(),
    );
    const w = new GoogleCalendarWriter(
      new GoogleAuth(
        async () => JSON.stringify(ACCOUNT),
        fetchFn,
        () => NOW,
      ),
      fetchFn,
    );
    const sent = () => {
      const [url, init] = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
      return { url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    };
    return { w, sent };
  }

  it("posts a timed event lasting an hour in the family's zone and returns its id", async () => {
    const { w, sent } = writer();
    expect(await w.insertEvent("kid@group.calendar.google.com", event)).toBe("evt123");
    const { url, init, body } = sent();
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/kid%40group.calendar.google.com/events",
    );
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer tok",
      "content-type": "application/json",
    });
    expect(body).toEqual({
      summary: "Soccer",
      description: "kids:\nAdded on the Kitchen frame.",
      start: { dateTime: "2026-11-16T16:30:00-05:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-11-16T17:30:00-05:00", timeZone: "America/New_York" },
    });
  });

  it("ends a late event on the next day", async () => {
    const { w, sent } = writer();
    await w.insertEvent("c", { ...event, time: "23:30" });
    expect(sent().body).toMatchObject({
      start: { dateTime: "2026-11-16T23:30:00-05:00" },
      end: { dateTime: "2026-11-17T00:30:00-05:00" },
    });
    await w.insertEvent("c", { ...event, date: "2026-12-31", time: "23:45", timeZone: "UTC" });
    expect(sent().body).toMatchObject({
      start: { dateTime: "2026-12-31T23:45:00+00:00", timeZone: "UTC" },
      end: { dateTime: "2027-01-01T00:45:00+00:00", timeZone: "UTC" },
    });
  });

  it("posts an all-day event with Google's exclusive end date", async () => {
    const { w, sent } = writer();
    await w.insertEvent("c", { ...event, date: "2026-12-31", time: null });
    expect(sent().body).toEqual({
      summary: "Soccer",
      description: "kids:\nAdded on the Kitchen frame.",
      start: { date: "2026-12-31" },
      end: { date: "2027-01-01" },
    });
  });

  it("surfaces Google errors", async () => {
    await expect(writer(() => reply({}, 403)).w.insertEvent("c", event)).rejects.toThrow(
      /insert answered 403/,
    );
  });

  it("covers several days for a longer all-day event", async () => {
    const { w, sent } = writer();
    await w.insertEvent("c", { ...event, date: "2026-11-18", time: null, days: 3 });
    expect(sent().body).toMatchObject({
      start: { date: "2026-11-18" },
      end: { date: "2026-11-21" },
    });
  });

  describe("getEvent", () => {
    it("reads one event in the family's zone with its exact length and series", async () => {
      const { w, sent } = writer(() =>
        reply({
          id: "abc_20261108T060000Z",
          summary: "Soccer",
          description: "Note",
          recurringEventId: "abc",
          // Crosses the end of DST: the wall clock says 01:30 twice, an hour apart.
          start: { dateTime: "2026-11-01T01:30:00-04:00" },
          end: { dateTime: "2026-11-01T01:30:00-05:00" },
        }),
      );
      expect(await w.getEvent("kid@cal", "abc_20261108T060000Z", "America/New_York")).toEqual({
        id: "abc_20261108T060000Z",
        title: "Soccer",
        description: "Note",
        start: { date: "2026-11-01", time: "01:30" },
        end: { date: "2026-11-01", time: "01:30" },
        allDay: false,
        seriesId: "abc",
        durationMinutes: 60,
      });
      expect(sent().url).toBe(
        "https://www.googleapis.com/calendar/v3/calendars/kid%40cal/events/abc_20261108T060000Z?timeZone=America%2FNew_York",
      );
    });

    it("reads an all-day one-off event", async () => {
      const { w } = writer(() =>
        reply({ id: "x", start: { date: "2026-11-18" }, end: { date: "2026-11-20" } }),
      );
      expect(await w.getEvent("c", "x", "UTC")).toMatchObject({
        allDay: true,
        seriesId: null,
        durationMinutes: null,
        title: "",
      });
    });

    it("answers null for an event that is not there, deleted or cancelled", async () => {
      expect(await writer(() => reply({}, 404)).w.getEvent("c", "x", "UTC")).toBeNull();
      expect(await writer(() => reply({}, 410)).w.getEvent("c", "x", "UTC")).toBeNull();
      const cancelled = writer(() =>
        reply({
          id: "x",
          status: "cancelled",
          start: { date: "2026-11-18" },
          end: { date: "2026-11-19" },
        }),
      );
      expect(await cancelled.w.getEvent("c", "x", "UTC")).toBeNull();
      await expect(writer(() => reply({}, 500)).w.getEvent("c", "x", "UTC")).rejects.toThrow(
        /get answered 500/,
      );
    });
  });

  it("patches an event's title, description and times", async () => {
    const { w, sent } = writer(() => reply({ id: "abc" }));
    await w.updateEvent("kid@cal", "abc_1", { ...event, title: "Soccer!" });
    const { url, init, body } = sent();
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/kid%40cal/events/abc_1");
    expect(init.method).toBe("PATCH");
    expect(body).toEqual({
      summary: "Soccer!",
      description: "kids:\nAdded on the Kitchen frame.",
      start: { dateTime: "2026-11-16T16:30:00-05:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-11-16T17:30:00-05:00", timeZone: "America/New_York" },
    });
  });

  it("moves an event to another calendar", async () => {
    const { w, sent } = writer(() => reply({ id: "abc" }));
    await w.moveEvent("kid@cal", "abc", "family@cal");
    const { url, init } = sent();
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/kid%40cal/events/abc/move?destination=family%40cal",
    );
    expect(init.method).toBe("POST");
  });

  it("deletes an event, counting one already gone as done", async () => {
    const { w, sent } = writer(() => new Response(null, { status: 204 }));
    await w.deleteEvent("kid@cal", "abc_20261118T210000Z");
    const { url, init } = sent();
    expect(url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/kid%40cal/events/abc_20261118T210000Z",
    );
    expect(init.method).toBe("DELETE");
    await expect(writer(() => reply({}, 410)).w.deleteEvent("c", "x")).resolves.toBeUndefined();
    await expect(writer(() => reply({}, 403)).w.deleteEvent("c", "x")).rejects.toThrow(
      CalendarRefusedError,
    );
    await expect(writer(() => reply({}, 503)).w.deleteEvent("c", "x")).rejects.toThrow(
      /delete answered 503/,
    );
  });

  it("tells a refused write from a failed one", async () => {
    for (const status of [400, 403, 404, 410]) {
      await expect(writer(() => reply({}, status)).w.updateEvent("c", "x", event)).rejects.toThrow(
        CalendarRefusedError,
      );
    }
    await expect(writer(() => reply({}, 403)).w.moveEvent("c", "x", "d")).rejects.toThrow(
      CalendarRefusedError,
    );
    const failed = writer(() => reply({}, 503)).w.updateEvent("c", "x", event);
    await expect(failed).rejects.toThrow(/update answered 503/);
    await expect(writer(() => reply({}, 503)).w.updateEvent("c", "x", event)).rejects.not.toThrow(
      CalendarRefusedError,
    );
  });
});

describe("zoned times", () => {
  const NY = "America/New_York";
  it("keeps an hour an hour across DST changes", () => {
    // Fall back: 00:30 EDT + 1h = 01:30 EDT (the first 01:30).
    const fall = zonedInstant("2026-11-01", "00:30", NY);
    expect(offsetDateTime(fall, NY)).toBe("2026-11-01T00:30:00-04:00");
    expect(offsetDateTime(fall + 3_600_000, NY)).toBe("2026-11-01T01:30:00-04:00");
    expect(offsetDateTime(fall + 7_200_000, NY)).toBe("2026-11-01T01:30:00-05:00");
    // Spring forward: 01:30 EST + 1h = 03:30 EDT; 02:30 does not exist and moves past the gap.
    const spring = zonedInstant("2026-03-08", "01:30", NY);
    expect(offsetDateTime(spring + 3_600_000, NY)).toBe("2026-03-08T03:30:00-04:00");
    expect(offsetDateTime(zonedInstant("2026-03-08", "02:30", NY), NY)).toBe(
      "2026-03-08T03:30:00-04:00",
    );
    expect(
      offsetDateTime(zonedInstant("2026-06-01", "09:00", "Asia/Kolkata"), "Asia/Kolkata"),
    ).toBe("2026-06-01T09:00:00+05:30");
  });
});

describe("signedAssertion", () => {
  it("is an RS256 JWT for calendar events (read-write) and read-only Drive", () => {
    const jwt = signedAssertion(ACCOUNT, NOW);
    const [header = "", claims = "", signature = ""] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: ACCOUNT.client_email,
      scope:
        "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    const ok = createVerify("RSA-SHA256")
      .update(`${header}.${claims}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("toEntry", () => {
  it("drops events with no usable start or end", () => {
    expect(toEntry({ id: "x", start: {}, end: { date: "2026-11-16" } })).toBeNull();
  });
});
