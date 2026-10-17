import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearSession } from "../src/nlu/context-engine";
import { understand } from "../src/nlu/friday";
import { detectSemanticAction } from "../src/nlu/semantic-engine";
import { KnowledgeStore } from "../src/transinfant/memory-store";
import { interpretWithLearnedKnowledge } from "../src/transinfant/interpretation-adapter";
import {
  inspectKnowledge,
  learnExperience,
  revertExperience,
} from "../src/transinfant/learner";

const testEmbeddingProvider = async (): Promise<number[]> => [1, 0];

async function createIsolatedStore(
  t: test.TestContext,
): Promise<{ store: KnowledgeStore; filePath: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "friday-transinfant-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "memory.json");
  return { store: new KnowledgeStore(filePath), filePath };
}

const curriculum = {
  id: "curriculum-1",
  source: "test-curriculum",
  entities: [
    { id: "summon", label: "summon" },
    { id: "open", label: "open" },
    { id: "editor", label: "editor" },
    { id: "application", label: "application" },
    { id: "reveal", label: "reveal" },
    { id: "show", label: "show" },
    { id: "grid", label: "grid" },
    { id: "spreadsheet", label: "spreadsheet" },
  ],
  relationships: [
    {
      subject: "summon",
      predicate: "equivalent-to",
      object: "open",
      source: "explicit" as const,
    },
    {
      subject: "editor",
      predicate: "is-a",
      object: "application",
      source: "explicit" as const,
    },
    {
      subject: "reveal",
      predicate: "equivalent-to",
      object: "show",
      source: "explicit" as const,
    },
    {
      subject: "grid",
      predicate: "is-a",
      object: "spreadsheet",
      source: "explicit" as const,
    },
  ],
};

test("learned relations compose independently taught action and entity concepts", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);

  const baseline = detectSemanticAction("summon editor");
  assert.equal(baseline.action, "unknown");
  assert.equal(baseline.object, "unknown");

  const interpreted = await interpretWithLearnedKnowledge(
    {
      text: "summon editor",
      baselineAction: baseline.action,
      baselineObject: baseline.object,
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
  );

  assert.equal(interpreted.status, "applied");
  assert.equal(interpreted.candidate?.action, "open");
  assert.equal(interpreted.candidate?.object, "application");
  assert.equal(interpreted.candidate?.source, "transinfant");
  assert.equal(interpreted.candidate?.evidence.length, 4);
});

test("retrieval-only mode returns one relation and does not compose a full frame", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);

  const retrieved = await interpretWithLearnedKnowledge(
    {
      text: "summon editor",
      baselineAction: "unknown",
      baselineObject: "unknown",
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
    "retrieval",
  );
  const composed = await interpretWithLearnedKnowledge(
    {
      text: "summon editor",
      baselineAction: "unknown",
      baselineObject: "unknown",
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
    "composition",
  );

  assert.equal(retrieved.status, "applied");
  assert.ok(
    (retrieved.candidate?.action === "open") !==
      (retrieved.candidate?.object === "application"),
  );
  assert.equal(composed.candidate?.action, "open");
  assert.equal(composed.candidate?.object, "application");
});

test("explicit baseline action takes precedence over conflicting learned action evidence", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);

  const result = await interpretWithLearnedKnowledge(
    {
      text: "show summon editor",
      baselineAction: "show",
      baselineObject: "unknown",
      explicitAction: true,
      explicitObject: false,
    },
    true,
    store,
  );

  assert.equal(result.status, "applied");
  assert.equal(result.candidate?.action, "show");
  assert.equal(result.candidate?.object, "application");
});

test("explicit negation blocks learned action and object composition", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);

  const result = await interpretWithLearnedKnowledge(
    {
      text: "don't summon editor",
      baselineAction: "unknown",
      baselineObject: "unknown",
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
  );

  assert.equal(result.status, "no-match");
  assert.match(result.reason ?? "", /negation/);
});

test("FRIDAY uses learned candidates only when explicitly enabled", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);
  clearSession("transinfant-on");
  clearSession("transinfant-off");

  const enabled = await understand("summon editor", "transinfant-on", {
    transinfantEnabled: true,
    transinfantStore: store,
    embeddingProvider: testEmbeddingProvider,
  });
  const disabled = await understand("summon editor", "transinfant-off", {
    transinfantEnabled: false,
    transinfantStore: store,
    embeddingProvider: testEmbeddingProvider,
  });

  assert.equal(enabled.semantic.action, "open");
  assert.equal(enabled.semantic.object, "application");
  assert.equal(enabled.intent.name, "workspace.open");
  assert.equal(
    (enabled.context.transinfant as { status: string }).status,
    "applied",
  );
  assert.equal(disabled.semantic.action, "unknown");
  assert.equal(
    (disabled.context.transinfant as { status: string }).status,
    "disabled",
  );
});

test("inferred facts remain candidates and are excluded from interpretation", async (t) => {
  const { store } = await createIsolatedStore(t);
  const learning = await learnExperience(
    {
      id: "candidate-only",
      source: "unverified-hypothesis",
      entities: [
        { id: "summon", label: "summon" },
        { id: "open", label: "open" },
        { id: "editor", label: "editor" },
        { id: "application", label: "application" },
      ],
      relationships: [
        {
          subject: "summon",
          predicate: "equivalent-to",
          object: "open",
          source: "inferred",
          confidence: 0.5,
        },
        {
          subject: "editor",
          predicate: "is-a",
          object: "application",
          source: "inferred",
          confidence: 0.5,
        },
      ],
    },
    store,
  );

  assert.equal(learning.candidateRelationshipIds.length, 2);
  const interpreted = await interpretWithLearnedKnowledge(
    {
      text: "summon editor",
      baselineAction: "unknown",
      baselineObject: "unknown",
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
  );
  assert.equal(interpreted.status, "no-match");
});

test("corrupt persistent memory reports degraded mode instead of claiming a learned result", async (t) => {
  const { store, filePath } = await createIsolatedStore(t);
  await writeFile(filePath, "{ invalid", "utf8");

  const result = await interpretWithLearnedKnowledge(
    {
      text: "summon editor",
      baselineAction: "unknown",
      baselineObject: "unknown",
      explicitAction: false,
      explicitObject: false,
    },
    true,
    store,
  );

  assert.equal(result.status, "degraded");
  assert.ok(result.reason);
  assert.equal(result.candidate, null);
});

test("contradictions are rejected, feedback can replace them, and reversal restores prior knowledge", async (t) => {
  const { store } = await createIsolatedStore(t);
  await learnExperience(
    {
      id: "first",
      source: "explicit-teaching",
      entities: [
        { id: "summon", label: "summon" },
        { id: "open", label: "open" },
        { id: "show", label: "show" },
      ],
      relationships: [
        {
          subject: "summon",
          predicate: "equivalent-to",
          object: "open",
          source: "explicit",
        },
      ],
    },
    store,
  );

  const rejected = await learnExperience(
    {
      id: "conflict",
      source: "unverified-teaching",
      entities: [
        { id: "summon", label: "summon" },
        { id: "show", label: "show" },
      ],
      relationships: [
        {
          subject: "summon",
          predicate: "equivalent-to",
          object: "show",
          source: "explicit",
        },
      ],
    },
    store,
  );
  assert.equal(rejected.rejectedRelationshipIds.length, 1);
  assert.equal(
    (await inspectKnowledge(store)).relationships.filter(
      (relationship) => relationship.status === "accepted",
    ).length,
    1,
  );

  await learnExperience(
    {
      id: "correction",
      source: "user-feedback",
      entities: [
        { id: "summon", label: "summon" },
        { id: "show", label: "show" },
      ],
      relationships: [
        {
          subject: "summon",
          predicate: "equivalent-to",
          object: "show",
          source: "feedback",
        },
      ],
    },
    store,
  );
  let snapshot = await inspectKnowledge(store);
  assert.equal(
    snapshot.relationships.find(
      (relationship) => relationship.experienceId === "first",
    )?.status,
    "superseded",
  );

  assert.equal(await revertExperience("correction", store), true);
  snapshot = await inspectKnowledge(store);
  assert.equal(
    snapshot.relationships.find(
      (relationship) => relationship.experienceId === "first",
    )?.status,
    "accepted",
  );
});

test("knowledge store persists across instances and bounds event growth", async (t) => {
  const { store, filePath } = await createIsolatedStore(t);
  await learnExperience(curriculum, store);

  const persisted = await readFile(filePath, "utf8");
  assert.match(persisted, /"schemaVersion": 1/);

  const reopened = new KnowledgeStore(filePath);
  const snapshot = await inspectKnowledge(reopened);
  assert.equal(snapshot.concepts.length, 8);
  assert.equal(snapshot.relationships.length, 4);
  assert.ok(snapshot.events.length <= 2_000);
});
