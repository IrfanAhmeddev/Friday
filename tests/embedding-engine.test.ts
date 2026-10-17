import assert from "node:assert/strict";
import test from "node:test";

import {
  EmbeddingEngine,
  EmbeddingError,
  type EmbeddingExtractor,
} from "../src/ml/embedding.engine";

function fixedExtractor(
  data: number[] = [0.25, -0.5, 0.75],
  dims: number[] = [3],
): EmbeddingExtractor {
  return async () => ({ data, dims });
}

test("concurrent embedding calls share model initialization", async () => {
  let loadCount = 0;
  let inferenceCount = 0;

  const engine = new EmbeddingEngine(async () => {
    loadCount++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return async () => {
      inferenceCount++;
      return { data: [0.1, 0.2], dims: [2] };
    };
  });

  const vectors = await Promise.all([
    engine.createEmbedding("first"),
    engine.createEmbedding("second"),
  ]);

  assert.equal(loadCount, 1);
  assert.equal(inferenceCount, 2);
  assert.deepEqual(vectors, [[0.1, 0.2], [0.1, 0.2]]);
  assert.deepEqual(engine.getStatus(), { state: "ready" });
});

test("failed model initialization is retryable", async () => {
  let loadCount = 0;
  const engine = new EmbeddingEngine(async () => {
    loadCount++;
    if (loadCount === 1) {
      throw new Error("transient loader failure");
    }
    return fixedExtractor();
  });

  await assert.rejects(
    engine.createEmbedding("retry"),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === "model_initialization_failed",
  );
  assert.deepEqual(engine.getStatus(), {
    state: "failed",
    failureCode: "model_initialization_failed",
  });

  assert.deepEqual(await engine.createEmbedding("retry"), [
    0.25,
    -0.5,
    0.75,
  ]);
  assert.equal(loadCount, 2);
  assert.deepEqual(engine.getStatus(), { state: "ready" });
});

test("blank text does not initialize the model", async () => {
  let loadCount = 0;
  const engine = new EmbeddingEngine(async () => {
    loadCount++;
    return fixedExtractor();
  });

  assert.deepEqual(await engine.createEmbedding(" \n "), []);
  assert.equal(loadCount, 0);
  assert.deepEqual(engine.getStatus(), { state: "cold" });
});

test("invalid embedding dimensions and non-finite values are rejected", async () => {
  const dimensionMismatch = new EmbeddingEngine(async () =>
    fixedExtractor([0.1, 0.2], [3]),
  );
  await assert.rejects(
    dimensionMismatch.createEmbedding("mismatch"),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === "invalid_embedding",
  );

  const nonFinite = new EmbeddingEngine(async () =>
    fixedExtractor([0.1, Number.NaN], [2]),
  );
  await assert.rejects(
    nonFinite.createEmbedding("non-finite"),
    (error: unknown) =>
      error instanceof EmbeddingError &&
      error.code === "invalid_embedding",
  );
});
