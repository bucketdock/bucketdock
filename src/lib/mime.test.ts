import { describe, it, expect } from "vitest";
import { s3DefaultContentType, fileExtension, mimeFromExtension } from "./mime";

describe("s3DefaultContentType", () => {
  it("returns em-dash for folders (keys ending in /)", () => {
    expect(s3DefaultContentType("foo/")).toBe("—");
    expect(s3DefaultContentType("a/b/c/")).toBe("—");
  });

  it("returns the S3 default for any file regardless of extension", () => {
    // We deliberately do NOT map .ttf -> font/ttf or .svg -> image/svg+xml
    // because S3 only stores what the uploader set, and ListObjectsV2 doesn't
    // expose Content-Type. Showing the default keeps the table honest.
    for (const key of [
      "fonts/Inter.ttf",
      "icons/logo.svg",
      "notes.txt",
      "photo.png",
      "archive.tar.gz",
      "noext",
    ]) {
      expect(s3DefaultContentType(key)).toBe("application/octet-stream");
    }
  });

  it("treats empty input as a folder placeholder", () => {
    expect(s3DefaultContentType("")).toBe("—");
  });

  it("aliases mimeFromExtension to the same default", () => {
    expect(mimeFromExtension("a.ttf")).toBe("application/octet-stream");
    expect(mimeFromExtension("dir/")).toBe("—");
  });
});

describe("fileExtension", () => {
  it("returns the lowercase extension without the dot", () => {
    expect(fileExtension("photo.PNG")).toBe("png");
    expect(fileExtension("a/b/c/Inter.ttf")).toBe("ttf");
  });

  it("returns empty string for files without an extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".hiddenfile")).toBe(""); // leading dot is not an ext
    expect(fileExtension("trailing.")).toBe("");
  });

  it("returns empty string for folders", () => {
    expect(fileExtension("foo/")).toBe("");
    expect(fileExtension("")).toBe("");
  });
});
