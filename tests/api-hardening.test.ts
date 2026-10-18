import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createApp } from "../src/api/app";
import { EmbeddingError } from "../src/ml/embedding.engine";
import type { NLUResult } from "../src/types/nlu";

const result: NLUResult = {
  status: "unknown",
  intent: { name: "unknown", confidence: 0 },
  semantic: {
    action: "unknown",
    object: "unknown",
    confidence: 0,
    matchedWords: [],
  },
  reference: {
    hasReference: false,
    reference: "unknown",
    referencedObject: "unknown",
    referencedName: null,
    matchedWords: [],
    confidence: 0,
  },
  entities: [],
  context: {},
};

async function withServer<T>(
  overrides: Parameters<typeof createApp>[0],
  callback: (url: string) => Promise<T>,
): Promise<T> {
  const server = createApp(overrides).listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function jsonPost(
  url: string,
  body: string,
  authorization?: string,
): Promise<globalThis.Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body,
  });
}

test("conversation endpoint keeps its response contract and accepts bearer auth", async () => {
  let observed: { text: string; sessionId: string } | undefined;

  await withServer(
    {
      apiKey: "local-test-key",
      understand: async (text, sessionId) => {
        observed = { text, sessionId };
        return result;
      },
    },
    async (url) => {
      const response = await jsonPost(
        `${url}/api/understand`,
        JSON.stringify({ text: "hello", sessionId: "android-client" }),
        "Bearer local-test-key",
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.match(response.headers.get("x-request-id") ?? "", /^[\da-f-]{36}$/i);
      assert.deepEqual(observed, {
        text: "hello",
        sessionId: "android-client",
      });
      const { intelligence, ...legacyResponse } = body;
      assert.deepEqual(legacyResponse, {
        apiVersion: "1",
        service: "friday",
        ...result,
      });
      assert.equal(intelligence.contractVersion, "1.0");
      assert.equal(intelligence.originalInput, "hello");
      assert.equal(intelligence.conversation.sessionId, "android-client");
      assert.equal(intelligence.planning.status, "not_proposed");
    },
  );
});

test("production fails closed when the API key is not configured", async () => {
  await withServer(
    {
      apiKey: undefined,
      production: true,
      understand: async () => result,
    },
    async (url) => {
      const response = await jsonPost(
        `${url}/understand`,
        JSON.stringify({ text: "hello" }),
      );
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.code, "authentication_not_configured");
      assert.ok(response.headers.get("x-request-id"));
    },
  );
});

test("invalid bodies, oversized text, sessions and malformed JSON get explicit responses", async () => {
  await withServer(
    { apiKey: undefined, production: false, understand: async () => result },
    async (url) => {
      const empty = await jsonPost(url + "/understand", "{}");
      assert.equal(empty.status, 400);
      assert.equal((await empty.json()).code, "invalid_request");

      const longText = await jsonPost(
        url + "/understand",
        JSON.stringify({ text: "x".repeat(4_001) }),
      );
      assert.equal(longText.status, 413);
      assert.equal((await longText.json()).code, "text_too_long");

      const invalidSession = await jsonPost(
        url + "/understand",
        JSON.stringify({ text: "hello", sessionId: 42 }),
      );
      assert.equal(invalidSession.status, 400);
      assert.equal((await invalidSession.json()).code, "invalid_session_id");

      const oversizedBody = await jsonPost(
        url + "/understand",
        JSON.stringify({ text: "x".repeat(33_000) }),
      );
      assert.equal(oversizedBody.status, 413);
      assert.equal((await oversizedBody.json()).code, "payload_too_large");

      const malformed = await jsonPost(url + "/understand", "{");
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).code, "invalid_json");
    },
  );
});

test("liveness stays simple and readiness reports sanitized asset failures", async () => {
  await withServer(
    {
      loadKnowledge: () => {
        throw new Error("private filesystem path");
      },
      initializeModel: async () => undefined,
    },
    async (url) => {
      const live = await fetch(url + "/api/health");
      assert.equal(live.status, 200);
      assert.deepEqual(await live.json(), {
        status: "ok",
        service: "friday",
        version: "0.1.0",
      });

      const ready = await fetch(url + "/api/ready");
      const body = await ready.json();
      assert.equal(ready.status, 503);
      assert.equal(body.status, "not_ready");
      assert.equal(body.components.knowledge, "unavailable");
      assert.deepEqual(body.diagnostics.knowledge, {
        code: null,
        message: "Knowledge data could not be loaded.",
      });
      assert.equal(JSON.stringify(body).includes("private filesystem path"), false);
    },
  );
});

test("readiness initializes the model before reporting ready", async () => {
  let initialized = false;
  await withServer(
    {
      loadKnowledge: () => undefined,
      initializeModel: async () => {
        initialized = true;
      },
      getModelStatus: () => ({
        state: initialized ? "ready" : "cold",
      }),
    },
    async (url) => {
      const response = await fetch(url + "/ready");
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "ready");
      assert.equal(body.components.knowledge, "available");
      assert.equal(body.components.sharp, "available");
      assert.equal(body.components.onnxRuntime, "available");
      assert.equal(body.components.embeddingModel, "ready");
      assert.equal(initialized, true);
    },
  );
});

test("readiness remains unavailable when model initialization fails", async () => {
  await withServer(
    {
      loadKnowledge: () => undefined,
      initializeModel: async () => {
        throw new EmbeddingError(
          "model_initialization_failed",
          "private model download path",
        );
      },
      getModelStatus: () => ({
        state: "failed",
        failureCode: "model_initialization_failed",
      }),
    },
    async (url) => {
      const response = await fetch(url + "/ready");
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.status, "not_ready");
      assert.equal(body.components.embeddingModel, "failed");
      assert.deepEqual(body.diagnostics.embeddingModel, {
        code: "model_initialization_failed",
        message: "The embedding model could not be initialized.",
      });
      assert.equal(JSON.stringify(body).includes("private model download path"), false);
    },
  );
});

test("missing optional Sharp does not mark text-NLU readiness unavailable", async () => {
  await withServer(
    {
      loadKnowledge: () => undefined,
      initializeModel: async () => undefined,
      checkRuntime: () => ({
        sharp: "unavailable",
        onnxRuntime: "available",
        sharpError: { code: "MODULE_NOT_FOUND", message: "optional image runtime absent" },
      }),
      getModelStatus: () => ({ state: "ready" }),
    },
    async (url) => {
      const response = await fetch(url + "/ready");
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "ready");
      assert.equal(body.components.sharp, "unavailable");
      assert.equal(body.optionalComponents.sharp, "unavailable");
      assert.equal(body.diagnostics.sharp.code, "MODULE_NOT_FOUND");
    },
  );
});

test("model initialization failures are surfaced without leaking internal errors", async () => {
  await withServer(
    {
      apiKey: undefined,
      production: false,
      understand: async () => {
        throw new EmbeddingError(
          "model_initialization_failed",
          "model init error containing a private path",
        );
      },
    },
    async (url) => {
      const response = await jsonPost(
        url + "/understand",
        JSON.stringify({ text: "open the report" }),
      );
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.code, "model_unavailable");
      assert.equal(JSON.stringify(body).includes("private path"), false);
      assert.ok(response.headers.get("x-request-id"));
    },
  );
});
