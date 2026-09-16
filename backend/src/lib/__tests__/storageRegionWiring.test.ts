/**
 * The two S3 clients in `storage.ts` must sign for the configured region.
 * `storageRegion.test.ts` covers the helper; this covers the wiring, because
 * a helper nobody calls is the failure mode a refactor would introduce.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  clientConfigs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    constructor(config: Record<string, unknown>) {
      mocks.clientConfigs.push(config);
    }
    send = mocks.send;
  }
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    S3Client,
    PutObjectCommand: Command,
    CopyObjectCommand: Command,
    DeleteObjectCommand: Command,
    HeadObjectCommand: Command,
    ListObjectsV2Command: Command,
    GetObjectCommand: Command,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

let getSignedUrl: typeof import("../storage").getSignedUrl;
let getSignedUploadUrl: typeof import("../storage").getSignedUploadUrl;

beforeAll(async () => {
  process.env.R2_ENDPOINT_URL = "https://s3.eu-west-2.amazonaws.com";
  process.env.R2_PUBLIC_ENDPOINT_URL = "";
  process.env.R2_ACCESS_KEY_ID = "test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.R2_REGION = "eu-west-2";
  vi.resetModules();
  ({ getSignedUploadUrl, getSignedUrl } = await import("../storage"));
});

beforeEach(() => {
  mocks.send.mockReset();
  mocks.getSignedUrl.mockReset();
  mocks.getSignedUrl.mockResolvedValue("https://signed.example.test/object");
  mocks.clientConfigs.length = 0;
});

describe("storage clients sign for R2_REGION", () => {
  it("constructs the download client with the configured region", async () => {
    await getSignedUrl("documents/example.pdf");
    expect(mocks.clientConfigs).toHaveLength(1);
    expect(mocks.clientConfigs[0]).toMatchObject({
      region: "eu-west-2",
      endpoint: "https://s3.eu-west-2.amazonaws.com",
    });
  });

  it("constructs the upload-signing client with the configured region", async () => {
    await getSignedUploadUrl({
      key: "upload-sessions/example/part",
      contentType: "application/pdf",
      contentLength: 1,
      expiresIn: 60,
    });
    const uploadClient = mocks.clientConfigs.at(-1);
    expect(uploadClient).toMatchObject({ region: "eu-west-2" });
  });
});
