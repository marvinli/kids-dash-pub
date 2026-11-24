import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { KMSClient } from "@aws-sdk/client-kms";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SNSClient } from "@aws-sdk/client-sns";
import type { IsoDate } from "@kids-dash/core";
import { z } from "zod";
import { CognitoClientRegistry } from "../adapters/cognito-clients";
import { CognitoDirectory } from "../adapters/cognito-directory";
import { CognitoTokenVerifier } from "../adapters/cognito-token-verifier";
import {
  DynamoChoreStore,
  DynamoCompletionStore,
  DynamoCounterStore,
  DynamoDeviceStore,
  DynamoFrameWatchStore,
  DynamoIncidentStore,
  DynamoNoteStore,
  DynamoSettingsStore,
  DynamoSnapshotStore,
  DynamoVideoConversionStore,
  Table,
} from "../adapters/dynamo";
import { FfmpegVideoConverter } from "../adapters/ffmpeg-video";
import { GoogleAuth } from "../adapters/google-auth";
import { GoogleCalendarReader, GoogleCalendarWriter } from "../adapters/google-calendar";
import { GoogleDriveMediaReader } from "../adapters/google-drive";
import { KmsSigner } from "../adapters/kms-signer";
import { LambdaVideoQueue } from "../adapters/lambda-video-queue";
import { OpenMeteoReader } from "../adapters/open-meteo";
import { S3PhotoStore } from "../adapters/s3-photo-store";
import { LogNotifier, SnsNotifier } from "../adapters/sns-notifier";
import { TheTriviaApiReader } from "../adapters/trivia-api";
import { WikimediaReader } from "../adapters/wikimedia";
import { AppService } from "../services/app-service";
import { BundleService } from "../services/bundle-service";
import { ChoreService } from "../services/chore-service";
import { CompletionService } from "../services/completion-service";
import { DeviceService } from "../services/device-service";
import { EventService } from "../services/event-service";
import { FamilyService } from "../services/family-service";
import { IncidentService } from "../services/incident-service";
import { OAuthService } from "../services/oauth-service";
import { PhotoService } from "../services/photo-service";
import type { Logger, Signer } from "../services/ports";
import { SyncService } from "../services/sync-service";
import { VideoConvertService } from "../services/video-convert";
import { WatchService } from "../services/watch-service";
import { jsonLogger } from "./logger";

/** Everything a handler can use. Handlers take this, so tests pass fakes. */
export interface Services {
  bundle: BundleService;
  family: FamilyService;
  photos: PhotoService;
  devices: DeviceService;
  app: AppService;
  completions: CompletionService;
  chores: ChoreService;
  events: EventService;
  incidents: IncidentService;
  oauth: OAuthService;
  sync: SyncService;
  videos: VideoConvertService;
  watch: WatchService;
  signer: Signer;
  logger: Logger;
}

const Env = z.object({
  TABLE_NAME: z.string().min(1),
  PHOTOS_BUCKET: z.string().min(1),
  SIGNING_KEY_ARN: z.string().min(1),
  GOOGLE_SECRET_ARN: z.string().min(1),
  /** The SNS topic frame alerts go to; without it they are only logged. */
  ALERT_TOPIC_ARN: z.string().min(1).optional(),
  /** The Cognito pool people sign in to for the hosted MCP (OAuth); only the MCP and OAuth functions get it. */
  USER_POOL_ID: z.string().min(1).optional(),
  USER_POOL_LOGIN_URL: z.url().optional(),
  MCP_SCOPE: z.string().min(1).optional(),
  /** The Cognito group (role) an account needs to use the MCP. */
  MCP_GROUP: z.string().min(1).optional(),
  /** The function that converts slideshow videos; without it videos are left out. */
  VIDEO_CONVERTER_FUNCTION: z.string().min(1).optional(),
  /** ffmpeg in the converter's layer. */
  FFMPEG_PATH: z.string().min(1).default("/opt/bin/ffmpeg"),
});

/** Secrets are re-read at most this often, so rotating one needs no deploy. */
const SECRET_TTL_MS = 5 * 60 * 1000;

/** The composition root: the only place adapters meet services. */
export function wire(env: NodeJS.ProcessEnv = process.env): Services {
  const config = Env.parse(env);
  const table = Table.fromEnv(config.TABLE_NAME);
  const clock = { now: () => new Date() };
  const logger = jsonLogger();

  const settings = new DynamoSettingsStore(table);
  const chores = new DynamoChoreStore(table);
  const notes = new DynamoNoteStore(table);
  const snapshots = new DynamoSnapshotStore(table);
  const completions = new DynamoCompletionStore(table);
  const devices = new DynamoDeviceStore(table);
  const counters = new DynamoCounterStore(table);
  const incidents = new DynamoIncidentStore(table);
  const photoStore = new S3PhotoStore(new S3Client({}), config.PHOTOS_BUCKET);
  const signer = new KmsSigner(new KMSClient({}), config.SIGNING_KEY_ARN);

  const secrets = new SecretsManagerClient({});
  let cached: { value: string | null; at: number } | undefined;
  const googleCredentials = async () => {
    if (cached && Date.now() - cached.at < SECRET_TTL_MS) return cached.value;
    const out = await secrets.send(
      new GetSecretValueCommand({ SecretId: config.GOOGLE_SECRET_ARN }),
    );
    cached = { value: out.SecretString ?? null, at: Date.now() };
    return cached.value;
  };
  const google = new GoogleAuth(googleCredentials);

  const wikimedia = new WikimediaReader();
  const media = new GoogleDriveMediaReader(google);
  const conversions = new DynamoVideoConversionStore(
    table,
    () => clock.now().toISOString().slice(0, 10) as IsoDate,
  );
  const sync = new SyncService({
    clock,
    settings,
    snapshots,
    devices,
    calendar: new GoogleCalendarReader(google),
    weather: new OpenMeteoReader(),
    trivia: new TheTriviaApiReader(),
    history: wikimedia,
    places: wikimedia,
    media,
    photos: photoStore,
    conversions,
    videos: config.VIDEO_CONVERTER_FUNCTION
      ? new LambdaVideoQueue(new LambdaClient({}), config.VIDEO_CONVERTER_FUNCTION)
      : null,
    logger,
  });

  const notifier = config.ALERT_TOPIC_ARN
    ? new SnsNotifier(new SNSClient({}), config.ALERT_TOPIC_ARN)
    : new LogNotifier(logger);

  const devicesService = new DeviceService({ clock, devices });
  const oauthConfig =
    config.USER_POOL_ID && config.USER_POOL_LOGIN_URL && config.MCP_SCOPE
      ? {
          userPoolId: config.USER_POOL_ID,
          loginBaseUrl: config.USER_POOL_LOGIN_URL,
          scope: config.MCP_SCOPE,
          group: config.MCP_GROUP ?? "dashboard",
        }
      : null;
  const cognitoClient = new CognitoIdentityProviderClient({});
  const oauth = new OAuthService({
    clock,
    config: oauthConfig,
    clients: new CognitoClientRegistry(
      cognitoClient,
      oauthConfig?.userPoolId ?? "",
      oauthConfig?.scope ?? "",
    ),
    tokens: new CognitoTokenVerifier(
      oauthConfig?.userPoolId ?? "us-east-1_none",
      oauthConfig?.scope ?? "",
      logger,
    ),
    directory: new CognitoDirectory(cognitoClient),
  });

  return {
    bundle: new BundleService({
      clock,
      settings,
      chores,
      notes,
      snapshots,
      completions,
      devices,
      signer,
    }),
    family: new FamilyService({
      settings,
      chores,
      notes,
      snapshots,
      photos: photoStore,
    }),
    photos: new PhotoService({ settings, photos: photoStore, snapshots, devices }),
    devices: devicesService,
    app: new AppService({ clock, snapshots, photos: photoStore }),
    completions: new CompletionService({ clock, settings, chores, completions }),
    chores: new ChoreService({ clock, settings, chores, counters, logger }),
    events: new EventService({
      clock,
      settings,
      devices,
      calendarWriter: new GoogleCalendarWriter(google),
      counters,
      sync,
      logger,
    }),
    incidents: new IncidentService({ clock, devices, incidents, counters, logger }),
    oauth,
    sync,
    videos: new VideoConvertService({
      clock,
      converter: new FfmpegVideoConverter(media, config.FFMPEG_PATH),
      photos: photoStore,
      conversions,
      logger,
    }),
    watch: new WatchService({
      clock,
      settings,
      devices,
      incidents,
      watch: new DynamoFrameWatchStore(table),
      notifier,
      logger,
    }),
    signer,
    logger,
  };
}

let services: Services | undefined;

/** Built on first use and reused across warm invocations. */
export function lazyServices(): Services {
  services ??= wire();
  return services;
}
