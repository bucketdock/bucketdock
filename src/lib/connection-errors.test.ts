import { describe, it, expect } from "vitest";
import { friendlyConnectionError } from "./connection-errors";

describe("friendlyConnectionError", () => {
  it("flags AccessDenied and suggests bucket filter when none is set", () => {
    const msg = friendlyConnectionError(new Error("AccessDenied: blah"), {
      hasBucketFilter: false,
    });
    expect(msg).toMatch(/access denied/i);
    expect(msg).toMatch(/buckets field/i);
  });

  it("flags AccessDenied without the bucket-field hint when one is set", () => {
    const msg = friendlyConnectionError(new Error("AccessDenied"), {
      hasBucketFilter: true,
    });
    expect(msg).toMatch(/access denied/i);
    expect(msg).not.toMatch(/buckets field/i);
  });

  it("recognises SignatureDoesNotMatch as a wrong-secret error", () => {
    const msg = friendlyConnectionError(
      new Error("SignatureDoesNotMatch: ..."),
      { hasBucketFilter: false },
    );
    expect(msg).toMatch(/secret access key/i);
  });

  it("recognises InvalidAccessKeyId", () => {
    expect(
      friendlyConnectionError(new Error("InvalidAccessKeyId"), {
        hasBucketFilter: false,
      }),
    ).toMatch(/access key id/i);
  });

  it("recognises NoSuchBucket", () => {
    expect(
      friendlyConnectionError(new Error("NoSuchBucket: foo"), {
        hasBucketFilter: false,
      }),
    ).toMatch(/bucket not found/i);
  });

  it("classifies network errors", () => {
    expect(
      friendlyConnectionError(new Error("dispatch failure"), {
        hasBucketFilter: false,
      }),
    ).toMatch(/couldn't reach/i);
    expect(
      friendlyConnectionError(new Error("connection refused"), {
        hasBucketFilter: false,
      }),
    ).toMatch(/couldn't reach/i);
  });

  it("trims multi-line errors to the first line", () => {
    const long = new Error("oops\nwith more cause chain\nand details");
    expect(friendlyConnectionError(long, { hasBucketFilter: false })).toBe(
      "oops",
    );
  });

  it("truncates very long single-line messages", () => {
    const giant = new Error("x".repeat(500));
    const out = friendlyConnectionError(giant, { hasBucketFilter: false });
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith("…")).toBe(true);
  });

  it("accepts non-Error values", () => {
    expect(
      friendlyConnectionError("plain string", { hasBucketFilter: false }),
    ).toBe("plain string");
  });
});
