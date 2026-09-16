import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_REGION, storageRegion } from "../storageRegion";

describe("storageRegion", () => {
  it('defaults to R2\'s "auto" when R2_REGION is unset', () => {
    expect(storageRegion({} as NodeJS.ProcessEnv)).toBe("auto");
    expect(DEFAULT_STORAGE_REGION).toBe("auto");
  });

  it("treats a blank value as unset", () => {
    expect(storageRegion({ R2_REGION: "" } as NodeJS.ProcessEnv)).toBe("auto");
    expect(storageRegion({ R2_REGION: "   " } as NodeJS.ProcessEnv)).toBe(
      "auto",
    );
  });

  it("returns a configured region, trimmed", () => {
    expect(storageRegion({ R2_REGION: "eu-west-2" } as NodeJS.ProcessEnv)).toBe(
      "eu-west-2",
    );
    expect(
      storageRegion({ R2_REGION: "  us-east-1\n" } as NodeJS.ProcessEnv),
    ).toBe("us-east-1");
  });

  it("rejects a value that cannot be a region, naming the variable", () => {
    expect(() =>
      storageRegion({ R2_REGION: "eu west 2" } as NodeJS.ProcessEnv),
    ).toThrow(/R2_REGION/);
    expect(() =>
      storageRegion({ R2_REGION: "https://s3.amazonaws.com" } as NodeJS.ProcessEnv),
    ).toThrow(/R2_REGION/);
  });
});
