import { describe, it, expect } from "vitest";
import {
  normalizeDstPrefix,
  selfCopyReason,
  browseUp,
  enterFolderPrefix,
  folderRowLabel,
  browseBreadcrumbs,
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

describe("browseUp", () => {
  it("returns empty string at the bucket root", () => {
    expect(browseUp("")).toBe("");
  });

  it("strips one segment from a top-level folder", () => {
    expect(browseUp("photos/")).toBe("");
  });

  it("strips one segment from a deep folder", () => {
    expect(browseUp("photos/2024/holidays/")).toBe("photos/2024/");
    expect(browseUp("photos/2024/")).toBe("photos/");
  });

  it("is idempotent at the root", () => {
    expect(browseUp(browseUp(""))).toBe("");
  });
});

describe("enterFolderPrefix", () => {
  // Regression: the old copy-modal concatenated the listing prefix on top
  // of itself when drilling deeper, because folder keys returned by S3 are
  // already absolute. The new helper returns the folder key as-is.
  it("uses the folder key directly when drilling in", () => {
    expect(enterFolderPrefix("photos/")).toBe("photos/");
    expect(enterFolderPrefix("photos/2024/")).toBe("photos/2024/");
    expect(enterFolderPrefix("photos/2024/holidays/")).toBe(
      "photos/2024/holidays/",
    );
  });

  it("ensures a trailing slash even if the listing returned the bare key", () => {
    expect(enterFolderPrefix("photos")).toBe("photos/");
  });

  it("returns empty for empty input", () => {
    expect(enterFolderPrefix("")).toBe("");
  });
});

describe("folderRowLabel", () => {
  it("strips the parent prefix", () => {
    expect(folderRowLabel("photos/2024/", "photos/")).toBe("2024");
  });

  it("strips the trailing slash at the root", () => {
    expect(folderRowLabel("photos/", "")).toBe("photos");
  });

  it("falls back to the full key when parent does not match", () => {
    expect(folderRowLabel("alpha/", "beta/")).toBe("alpha");
  });
});

describe("browseBreadcrumbs", () => {
  it("returns just the bucket crumb at the root", () => {
    expect(browseBreadcrumbs("my-bucket", "")).toEqual([
      { label: "my-bucket", prefix: "" },
    ]);
  });

  it("builds incremental prefixes for each segment", () => {
    expect(browseBreadcrumbs("my-bucket", "photos/2024/holidays/")).toEqual([
      { label: "my-bucket", prefix: "" },
      { label: "photos", prefix: "photos/" },
      { label: "2024", prefix: "photos/2024/" },
      { label: "holidays", prefix: "photos/2024/holidays/" },
    ]);
  });

  it("tolerates a missing trailing slash", () => {
    expect(browseBreadcrumbs("b", "a/b")).toEqual([
      { label: "b", prefix: "" },
      { label: "a", prefix: "a/" },
      { label: "b", prefix: "a/b/" },
    ]);
  });
});
