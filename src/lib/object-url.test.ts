import { describe, expect, it } from "vitest";
import { buildPublicObjectUrl } from "./object-url";
import type { Connection } from "./tauri";

const baseConnection: Connection = {
  id: "c1",
  name: "Test",
  provider: "custom",
  endpoint: "https://objects.example.com/",
  region: "us-east-1",
  access_key_id: "key",
  bucket_filter: null,
};

describe("buildPublicObjectUrl", () => {
  it("uses an AWS virtual-hosted URL when no endpoint is configured", () => {
    expect(
      buildPublicObjectUrl(
        { ...baseConnection, provider: "aws", endpoint: null },
        "photos",
        "2024/summer photo.jpg",
      ),
    ).toBe("https://photos.s3.us-east-1.amazonaws.com/2024/summer%20photo.jpg");
  });

  it("uses the configured endpoint in path-style URLs", () => {
    expect(
      buildPublicObjectUrl(baseConnection, "media", "a/b?#.txt"),
    ).toBe("https://objects.example.com/media/a/b%3F%23.txt");
  });

  it("returns null when there is no usable connection endpoint", () => {
    expect(
      buildPublicObjectUrl(
        { ...baseConnection, provider: "custom", endpoint: null },
        "media",
        "file.txt",
      ),
    ).toBeNull();
  });
});
