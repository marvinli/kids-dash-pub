import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { fakeWorld } from "../../test/fakes";
import { createAuthorizer } from "./authorizer";
import { createConvertVideoHandler } from "./convert-video";
import { jsonLogger } from "./logger";
import { createSyncHandler } from "./sync";
import { createWatchHandler } from "./watch";
import { lazyServices, wire } from "./wiring";

const authEvent = (authorization?: string) =>
  ({
    headers: authorization ? { authorization } : {},
  }) as unknown as APIGatewayRequestAuthorizerEventV2;

describe("authorizer", () => {
  it("authorizes registered devices and passes the device id on", async () => {
    const w = fakeWorld();
    const { device, token } = await w.services.devices.register({ name: "Frame" });
    const authorize = createAuthorizer(() => w.services);
    expect(await authorize(authEvent(`Bearer ${token}`))).toEqual({
      isAuthorized: true,
      context: { deviceId: device.id, role: "device" },
    });
    expect(await authorize(authEvent())).toEqual({ isAuthorized: false });
  });

  it("denies, and logs, when the check itself fails", async () => {
    const w = fakeWorld();
    w.devices.get = async () => {
      throw new Error("throttled");
    };
    const authorize = createAuthorizer(() => w.services);
    expect(await authorize(authEvent(`${"0".repeat(16)}.${"A".repeat(43)}`))).toEqual({
      isAuthorized: false,
    });
    expect(w.logger.lines[0]).toMatchObject({ level: "error", message: "authorizer failed" });
  });
});

describe("watch handler", () => {
  it("runs the watch service", async () => {
    const w = fakeWorld();
    expect(await createWatchHandler(() => w.services)()).toEqual({ offline: [], sent: 0 });
  });
});

describe("convert-video handler", () => {
  it("converts the item it is sent, and refuses anything else", async () => {
    const w = fakeWorld();
    w.converter.outputs.set("v", new Uint8Array([1]));
    const handler = createConvertVideoHandler(() => w.services);
    await handler({ sourceId: "v", version: "2", kind: "video", sizeBytes: 5, durationMs: null });
    expect(w.conversions.records.get("v#2")?.state).toBe("done");
    await expect(handler({ sourceId: "v" })).rejects.toThrow();
  });
});

describe("sync handler", () => {
  it("runs the sync service", async () => {
    const w = fakeWorld();
    expect(await createSyncHandler(() => w.services)()).toEqual({
      calendar: "ok",
      events: 0,
      weather: "ok",
      trivia: "ok",
      history: "ok",
      place: "ok",
      slides: "skipped",
      slideCount: 0,
    });
  });
});

describe("jsonLogger", () => {
  it("writes one JSON line per entry", () => {
    const lines: string[] = [];
    const logger = jsonLogger((line) => lines.push(line));
    logger.info("hello", { a: 1 });
    logger.warn("careful");
    logger.error("oops");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { level: "info", message: "hello", a: 1 },
      { level: "warn", message: "careful" },
      { level: "error", message: "oops" },
    ]);
  });
});

describe("wiring", () => {
  it("refuses to start without its configuration", () => {
    expect(() => wire({})).toThrow();
  });

  it("builds every service from the environment", () => {
    const services = wire({
      TABLE_NAME: "t",
      PHOTOS_BUCKET: "b",
      SIGNING_KEY_ARN: "arn:aws:kms:us-east-1:1:key/abc",
      GOOGLE_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:1:secret:g",
    });
    expect(services.signer.keyId).toBe("abc");
    expect(Object.keys(services).sort()).toEqual(
      [
        "app",
        "bundle",
        "chores",
        "completions",
        "devices",
        "events",
        "family",
        "incidents",
        "logger",
        "oauth",
        "photos",
        "signer",
        "sync",
        "videos",
        "watch",
      ].sort(),
    );
    expect(() => services.oauth.protectedResource("https://api.example")).toThrow(/not set up/);
  });

  it("turns OAuth on when the MCP functions get a user pool", () => {
    const services = wire({
      TABLE_NAME: "t",
      PHOTOS_BUCKET: "b",
      SIGNING_KEY_ARN: "arn:aws:kms:us-east-1:1:key/abc",
      GOOGLE_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:1:secret:g",
      USER_POOL_ID: "us-east-1_abc",
      USER_POOL_LOGIN_URL: "https://kids.auth.us-east-1.amazoncognito.com",
      MCP_SCOPE: "https://api.example/mcp/dashboard",
    });
    expect(services.oauth.authorizationServer("https://api.example").token_endpoint).toBe(
      "https://kids.auth.us-east-1.amazoncognito.com/oauth2/token",
    );
  });

  it("sends alerts through the topic when one is configured", () => {
    const services = wire({
      TABLE_NAME: "t",
      PHOTOS_BUCKET: "b",
      SIGNING_KEY_ARN: "arn:aws:kms:us-east-1:1:key/abc",
      GOOGLE_SECRET_ARN: "arn:aws:secretsmanager:us-east-1:1:secret:g",
      ALERT_TOPIC_ARN: "arn:aws:sns:us-east-1:1:alerts",
    });
    expect(services.watch).toBeDefined();
  });

  it("builds lazily from process.env once", () => {
    Object.assign(process.env, {
      TABLE_NAME: "t",
      PHOTOS_BUCKET: "b",
      SIGNING_KEY_ARN: "arn:aws:kms:us-east-1:1:key/abc",
      GOOGLE_SECRET_ARN: "g",
    });
    expect(lazyServices()).toBe(lazyServices());
  });
});
