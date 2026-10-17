import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearSession } from "../src/nlu/context-engine";
import { understand } from "../src/nlu/friday";
import { KnowledgeStore } from "../src/transinfant/memory-store";
import { revertExperience } from "../src/transinfant/learner";
import {
  composeWithVocabulary,
  exportVocabularySnapshot,
  inspectVocabulary,
  queryVocabulary,
  resetVocabularyMemory,
  teachVocabulary,
  type VocabularyExperience,
} from "../src/transinfant/vocabulary-learning";

const testEmbeddingProvider = async (): Promise<number[]> => [1, 0];

async function createStore(
  t: test.TestContext,
): Promise<{ store: KnowledgeStore; filePath: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "friday-tida-003-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "vocabulary.json");
  return { store: new KnowledgeStore(filePath), filePath };
}

function vocabulary(
  id: string,
  kind: "symbol" | "word",
  inputId: string,
  surface: string,
  conceptId: string,
  conceptLabel: string,
  semanticRole: "entity" | "predicate" | "property" = "entity",
  source: "explicit" | "feedback" | "inferred" = "explicit",
): VocabularyExperience {
  return {
    id,
    source: `test:${id}`,
    input: { id: inputId, kind, surface },
    concept: { id: conceptId, label: conceptLabel, semanticRole },
    confidence: source === "inferred" ? 0.5 : 0.9,
    relationshipSource: source,
  };
}

const svoRule = {
  id: "test-svo",
  tokenCount: 3,
  roles: ["entity", "predicate", "entity"],
  outputSlots: ["subject", "predicate", "object"] as const,
};

test("word and symbol associations retain confidence, event provenance, and aliases", async (t) => {
  const { store, filePath } = await createStore(t);
  await teachVocabulary({
    ...vocabulary(
      "word-cat",
      "word",
      "word.cat",
      "cat",
      "meaning.cat",
      "cat",
    ),
    input: { id: "word.cat", kind: "word", surface: "cat", aliases: ["kitty"] },
    concept: {
      id: "meaning.cat",
      label: "cat",
      semanticRole: "entity",
      definition: "A domesticated feline.",
    },
    exampleUsage: "cat see dog",
  }, store);
  await teachVocabulary(
    vocabulary(
      "symbol-A",
      "symbol",
      "symbol.A",
      "A",
      "meaning.cat",
      "cat",
    ),
    store,
  );

  const result = await queryVocabulary("word", "kitty", store);
  assert.equal(result.recognized, true);
  assert.deepEqual(result.inputEntityIds, ["word.cat"]);
  assert.equal(result.status, "supported");
  assert.equal(result.concept?.id, "meaning.cat");
  assert.equal(result.concept?.definition, "A domesticated feline.");
  assert.equal(result.confidence, 0.9);
  assert.equal(result.provenance[0].experienceId, "word-cat");
  assert.equal(result.provenance[0].source, "test:word-cat");
  assert.equal(result.provenance[0].status, "accepted");
  assert.equal(result.learningEvents[0].experienceId, "word-cat");

  const symbol = await queryVocabulary("symbol", "a", store);
  assert.equal(symbol.recognized, true);
  assert.deepEqual(symbol.inputEntityIds, ["symbol.A"]);
  assert.equal(symbol.concept?.id, "meaning.cat");
  const exported = JSON.parse(await exportVocabularySnapshot(store)) as {
    relationships: Array<{ experienceId: string }>;
  };
  assert.equal(exported.relationships.length, 2);
  assert.equal(exported.relationships[0].experienceId, "word-cat");
  assert.ok((await readFile(filePath, "utf8")).includes("exampleUsage"));
});

test("unknown words and candidate-only ambiguous associations abstain", async (t) => {
  const { store } = await createStore(t);
  const unknown = await queryVocabulary("word", "untrained", store);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.recognized, false);

  await teachVocabulary(
    vocabulary(
      "mep-cat",
      "word",
      "word.mep",
      "mep",
      "meaning.cat",
      "cat",
      "entity",
      "inferred",
    ),
    store,
  );
  assert.equal(
    (await queryVocabulary("word", "mep", store)).status,
    "uncertain",
  );
  await teachVocabulary(
    vocabulary(
      "mep-dog",
      "word",
      "word.mep",
      "mep",
      "meaning.dog",
      "dog",
      "entity",
      "inferred",
    ),
    store,
  );

  const ambiguous = await queryVocabulary("word", "mep", store);
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.recognized, true);
  assert.equal(ambiguous.concept, null);
  assert.deepEqual(
    new Set(ambiguous.candidateConceptIds),
    new Set(["meaning.cat", "meaning.dog"]),
  );
  assert.ok(ambiguous.provenance.every((item) => item.status === "candidate"));
  assert.equal((await inspectVocabulary(store)).events.length, 2);
});

test("composition applies only the supplied role rule to supported word meanings", async (t) => {
  const { store } = await createStore(t);
  await teachVocabulary(
    vocabulary("cat", "word", "word.cat", "cat", "meaning.cat", "cat"),
    store,
  );
  await teachVocabulary(
    vocabulary(
      "see",
      "word",
      "word.see",
      "see",
      "meaning.see",
      "see",
      "predicate",
    ),
    store,
  );
  await teachVocabulary(
    vocabulary("dog", "word", "word.dog", "dog", "meaning.dog", "dog"),
    store,
  );
  await teachVocabulary(
    vocabulary(
      "red",
      "word",
      "word.red",
      "red",
      "meaning.red",
      "red",
      "property",
    ),
    store,
  );

  const composed = await composeWithVocabulary("cat see dog", svoRule, store);
  assert.equal(composed.status, "supported");
  assert.deepEqual(composed.frame, {
    subject: "meaning.cat",
    predicate: "meaning.see",
    object: "meaning.dog",
  });
  assert.equal(composed.evidence.length, 3);
  assert.equal(
    (await composeWithVocabulary("cat red dog", svoRule, store)).status,
    "unsupported",
  );
  assert.equal(
    (await composeWithVocabulary("cat see unknown", svoRule, store)).status,
    "unknown",
  );
  assert.equal(
    (await composeWithVocabulary("cat see dog", svoRule, store, false)).status,
    "disabled",
  );
});

test("corrections are reversible, preserve unrelated associations, and duplicates do not add facts", async (t) => {
  const { store } = await createStore(t);
  await teachVocabulary(
    vocabulary("initial", "symbol", "symbol.C", "C", "meaning.cat", "cat"),
    store,
  );
  await teachVocabulary(
    vocabulary("unrelated", "word", "word.book", "book", "meaning.book", "book"),
    store,
  );
  const beforeDuplicate = (await store.read()).relationships.length;
  const duplicate = await teachVocabulary(
    vocabulary("duplicate", "symbol", "symbol.C", "C", "meaning.cat", "cat"),
    store,
  );
  assert.equal(duplicate.acceptedRelationshipIds.length, 1);
  assert.equal((await store.read()).relationships.length, beforeDuplicate);

  const conflict = await teachVocabulary(
    vocabulary("conflict", "symbol", "symbol.C", "C", "meaning.dog", "dog"),
    store,
  );
  assert.equal(conflict.rejectedRelationshipIds.length, 1);
  const correction = await teachVocabulary(
    vocabulary(
      "correction",
      "symbol",
      "symbol.C",
      "C",
      "meaning.dog",
      "dog",
      "entity",
      "feedback",
    ),
    store,
  );
  assert.equal(correction.acceptedRelationshipIds.length, 1);
  assert.equal((await queryVocabulary("symbol", "C", store)).concept?.id, "meaning.dog");
  assert.equal((await queryVocabulary("word", "book", store)).concept?.id, "meaning.book");

  const reverted = await revertExperience("correction", store);
  assert.equal(reverted, true);
  assert.equal((await queryVocabulary("symbol", "C", store)).concept?.id, "meaning.cat");
  assert.equal((await queryVocabulary("word", "book", store)).concept?.id, "meaning.book");
});

test("reset clears only the supplied isolated store", async (t) => {
  const { store } = await createStore(t);
  await teachVocabulary(
    vocabulary("word-cat", "word", "word.cat", "cat", "meaning.cat", "cat"),
    store,
  );
  await resetVocabularyMemory(store);
  const result = await queryVocabulary("word", "cat", store);
  assert.equal(result.status, "unknown");
  assert.equal(result.recognized, false);
  assert.equal((await store.read()).relationships.length, 0);
});

test("vocabulary reset refuses to touch FRIDAY's default production store", async () => {
  await assert.rejects(
    resetVocabularyMemory(new KnowledgeStore()),
    /production TransInfant store is protected/,
  );
});

test("corrupt memory reads fail explicitly and are not replaced by an empty snapshot", async (t) => {
  const { store, filePath } = await createStore(t);
  const corrupt = "{broken-json";
  await writeFile(filePath, corrupt, "utf8");
  await assert.rejects(queryVocabulary("word", "cat", store), /Could not parse/);
  assert.equal(await readFile(filePath, "utf8"), corrupt);
});

test("FRIDAY can use a taught vocabulary association only when TransInfant is enabled", async (t) => {
  const { store } = await createStore(t);
  await teachVocabulary(
    vocabulary(
      "summon-open",
      "word",
      "word.summon",
      "summon",
      "meaning.open",
      "open",
      "predicate",
    ),
    store,
  );
  await teachVocabulary(
    vocabulary(
      "memo-note",
      "word",
      "word.memo",
      "memo",
      "meaning.note",
      "note",
    ),
    store,
  );
  clearSession("tida-003-enabled");
  clearSession("tida-003-disabled");
  clearSession("tida-003-negation");
  clearSession("tida-003-explicit-action");

  const enabled = await understand("summon memo", "tida-003-enabled", {
    transinfantEnabled: true,
    transinfantStore: store,
    embeddingProvider: testEmbeddingProvider,
  });
  const disabled = await understand("summon memo", "tida-003-disabled", {
    transinfantEnabled: false,
    transinfantStore: store,
    embeddingProvider: testEmbeddingProvider,
  });
  const negated = await understand("don't summon memo", "tida-003-negation", {
    transinfantEnabled: true,
    transinfantStore: store,
    embeddingProvider: testEmbeddingProvider,
  });
  const explicitAction = await understand(
    "show summon memo",
    "tida-003-explicit-action",
    {
      transinfantEnabled: true,
      transinfantStore: store,
      embeddingProvider: testEmbeddingProvider,
    },
  );

  assert.equal(enabled.semantic.action, "open");
  assert.equal(enabled.semantic.object, "note");
  assert.ok(
    JSON.stringify(enabled.context.transinfant).includes("accepted denotes relationship"),
  );
  assert.equal(disabled.semantic.action, "unknown");
  assert.equal(disabled.semantic.object, "unknown");
  assert.equal(
    (disabled.context.transinfant as { status: string }).status,
    "disabled",
  );
  assert.equal(negated.semantic.action, "unknown");
  assert.equal(negated.semantic.object, "unknown");
  assert.equal(explicitAction.semantic.action, "show");
  assert.equal(explicitAction.semantic.object, "note");
});

test("FRIDAY vocabulary interpretation remains opt-in through FRIDAY_TRANSINFANT", async (t) => {
  const { store } = await createStore(t);
  await teachVocabulary(
    vocabulary(
      "summon-open-flag",
      "word",
      "word.summon",
      "summon",
      "meaning.open",
      "open",
      "predicate",
    ),
    store,
  );
  await teachVocabulary(
    vocabulary(
      "memo-note-flag",
      "word",
      "word.memo",
      "memo",
      "meaning.note",
      "note",
    ),
    store,
  );
  const originalFlag = process.env.FRIDAY_TRANSINFANT;
  try {
    delete process.env.FRIDAY_TRANSINFANT;
    clearSession("tida-003-flag-off");
    const disabled = await understand(
      "summon memo",
      "tida-003-flag-off",
      { transinfantStore: store, embeddingProvider: testEmbeddingProvider },
    );
    assert.equal(disabled.semantic.action, "unknown");
    assert.equal(disabled.semantic.object, "unknown");

    process.env.FRIDAY_TRANSINFANT = "true";
    clearSession("tida-003-flag-on");
    const enabled = await understand(
      "summon memo",
      "tida-003-flag-on",
      { transinfantStore: store, embeddingProvider: testEmbeddingProvider },
    );
    assert.equal(enabled.semantic.action, "open");
    assert.equal(enabled.semantic.object, "note");

    clearSession("tida-003-explicit-disable");
    const explicitDisable = await understand(
      "summon memo",
      "tida-003-explicit-disable",
      {
        transinfantEnabled: false,
        transinfantStore: store,
        embeddingProvider: testEmbeddingProvider,
      },
    );
    assert.equal(explicitDisable.semantic.action, "unknown");
    assert.equal(explicitDisable.semantic.object, "unknown");
  } finally {
    if (originalFlag === undefined) {
      delete process.env.FRIDAY_TRANSINFANT;
    } else {
      process.env.FRIDAY_TRANSINFANT = originalFlag;
    }
  }
});
