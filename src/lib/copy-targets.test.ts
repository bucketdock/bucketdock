import { describe, it, expect } from "vitest";
import {
  normalizeDstPrefix,
  selfCopyReason,
  type CopyTarget,
} from "./copy-targets";

const baseSelf: CopyTarget = {
  srcConnectionId: "c",
  srcBucket: "b",
  srcPrefix: "photos/",
  selectedKeys: ["photos/a.jpg", "photos/b.jpg"],
  dstConnectionId: "c",
  dstBucket: "b",
  dstPrefixRaw: "photos/",
};

describe("normalizeDstPrefix", () => {
  it("returns empty string for blank input (root)", () => {
    expect(normalizeDstPrefix("")).toBe("");
    expect(normalizeDstPrefix("   ")).toBe("");
  });
  it("ensures a trailing slash", () => {
    expect(normalizeDstPrefix("a/b")).toBe("a/b/");
    expect(normalizeDstPrefix("a/b/")).toBe("a/b/");
  });
});

describe("selfCopyReason", () => {
  it("blocks copying into the same folder on the same bucket/connection", () => {
    expect(selfCopyReason(baseSelf)).toMatch(/overwrite the source/i);
  });

  it("allows copying to a different bucket on the same connection", () => {
    expect(selfCopyReason({ ...baseSelf, dstBucket: "other" })).toBeNull();
  });

  it("allows copying to a different connection", () => {
    expect(
      selfCopyReason({ ...baseSelf, dstConnectionId: "other" }),
    ).toBeNull();
  });

  it("allows copying to a sibling folder", () => {
    expect(
      selfCopyReason({ ...baseSelf, dstPrefixRaw: "archive/" }),
    ).toBeNull();
  });

  it("blocks copying into a destination inside one of the selected folders", () => {
    const t: CopyTarget = {
      ...baseSelf,
      srcPrefix: "",
      selectedKeys: ["folderA/"],
      dstPrefixRaw: "folderA/sub",
    };
    expect(selfCopyReason(t)).toMatch(/folderA\//);
  });

  it("does not block when the selected items are only files (not folders)", () => {
    const t: CopyTarget = {
      ...baseSelf,
      srcPrefix: "",
      selectedKeys: ["file.txt"],
      dstPrefixRaw: "elsewhere/",
    };
    expect(selfCopyReason(t)).toBeNull();
  });

  it("treats empty dstPrefix as bucket root and blocks if source was already root", () => {
    const t: CopyTarget = {
      ...baseSelf,
      srcPrefix: "",
      dstPrefixRaw: "",
      selectedKeys: ["a.txt"],
    };
    expect(selfCopyReason(t)).toMatch(/overwrite/i);
  });
});
