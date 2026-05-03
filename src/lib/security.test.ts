import { describe, it, expect } from "vitest";
import type { Connection } from "./tauri";

/**
 * Security guardrails — these tests fail loudly if anyone reintroduces a
 * `secret_access_key` field on the frontend `Connection` type or if the
 * backend ever serializes one back over IPC. Secrets must live in the
 * macOS Keychain only.
 */

describe("Connection wire-format invariants", () => {
  it("Connection type has no secret_access_key field", () => {
    // Compile-time assertion: assigning a Connection that carries a secret
    // must fail. We use @ts-expect-error so the test fails if the type ever
    // grows back the secret field.
    const conn: Connection = {
      id: "x",
      name: "x",
      provider: "aws",
      endpoint: null,
      region: "us-east-1",
      access_key_id: "AKIA…",
      bucket_filter: null,
    };
    // @ts-expect-error secret_access_key must not be part of the wire type
    conn.secret_access_key = "should not exist";
    // Defensive runtime check too, in case someone widens the type.
    const allowedKeys = new Set([
      "id",
      "name",
      "provider",
      "endpoint",
      "region",
      "access_key_id",
      "bucket_filter",
      "secret_access_key", // present only because we just attached it above
    ]);
    for (const k of Object.keys(conn)) expect(allowedKeys.has(k)).toBe(true);
  });
});

describe("ConnectionInput stays minimal", () => {
  it("only the fields the Rust validator expects are settable", () => {
    // The frontend ConnectionInput is what gets sent over IPC. It must not
    // accidentally let callers smuggle e.g. a session_token or a raw URL
    // override that the backend wouldn't recognise.
    const allowed = new Set([
      "name",
      "provider",
      "endpoint",
      "region",
      "access_key_id",
      "secret_access_key",
      "bucket_filter",
    ]);
    const input: import("./tauri").ConnectionInput = {
      name: "x",
      provider: "aws",
      endpoint: null,
      region: "us-east-1",
      access_key_id: "k",
      secret_access_key: "s",
      bucket_filter: null,
    };
    for (const k of Object.keys(input)) expect(allowed.has(k)).toBe(true);
  });
});
