import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clearSession } from "../src/nlu/context-engine";
import { understand } from "../src/nlu/friday";
import { KnowledgeStore } from "../src/transinfant/memory-store";
import {
  analyzeUnlabeledPatternAmbiguity,
  GrammarPatternStore,
  induceGrammarPattern,
  interpretWithGrammarPattern,
  type LabeledPatternExample,
} from "../src/transinfant/grammar-pattern";
import { teachVocabulary, type VocabularyExperience } from "../src/transinfant/vocabulary-learning";

const testEmbeddingProvider = async (): Promise<number[]> => [1, 0];

const examples: LabeledPatternExample[] = [
  {
    id: "one",
    tokens: ["Mira", "dax", "lumo"],
    frame: { subject: "Mira", predicate: "dax", object: "lumo" },
  },
  {
    id: "two",
    tokens: ["Tavi", "vek", "neri"],
    frame: { subject: "Tavi", predicate: "vek", object: "neri" },
  },
  {
    id: "three",
    tokens: ["Sena", "dax", "neri"],
    frame: { subject: "Sena", predicate: "dax", object: "neri" },
  },
];

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "friday-pattern-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("weakly supervised pattern induction selects a reusable positional pattern", async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new GrammarPatternStore(path.join(directory, "pattern.json"));
  const snapshot = induceGrammarPattern(examples);
  assert.equal(snapshot.status, "accepted");
  assert.equal(induceGrammarPattern(examples).id, snapshot.id);
  assert.deepEqual(snapshot.pattern, ["subject", "predicate", "object"]);
  assert.equal(snapshot.candidates.length, 6);
  assert.deepEqual(snapshot.evidenceIds, ["one", "three", "two"]);

  await store.write(snapshot);
  const result = await interpretWithGrammarPattern("Tavi vek lumo", store, {}, [
    "mira", "dax", "lumo", "tavi", "vek", "neri", "sena",
  ]);
  assert.equal(result.status, "supported");
  assert.deepEqual(result.frame, {
    subject: "tavi",
    predicate: "vek",
    object: "lumo",
  });
  assert.equal(result.source, "induced");
  assert.deepEqual(result.provenance, ["one", "three", "two"]);
  assert.equal(result.confidence, 1);

  const reordered = await interpretWithGrammarPattern("lumo dax Mira", store);
  assert.deepEqual(reordered.frame, {
    subject: "lumo",
    predicate: "dax",
    object: "mira",
  });
  assert.equal(
    (await interpretWithGrammarPattern("Mira blarg lumo", store, {}, ["mira", "dax", "lumo"]))
      .status,
    "unknown",
  );
  assert.equal((await interpretWithGrammarPattern("Mira dax", store)).status, "unsupported");
  const negated = await interpretWithGrammarPattern("not dax lumo", store);
  assert.equal(negated.status, "unsupported");
  assert.match(negated.reason ?? "", /negation/);
});

test("unlabeled examples remain ambiguous and insufficient, contradictory, and duplicate evidence do not overstate confidence", () => {
  const unlabeled = analyzeUnlabeledPatternAmbiguity([
    ["Mira", "dax", "lumo"],
    ["Tavi", "dax", "neri"],
    ["Mira", "vek", "neri"],
    ["Sena", "vek", "lumo"],
  ]);
  assert.equal(unlabeled.length, 6);
  assert.equal(new Set(unlabeled.map((candidate) => candidate.score)).size, 1);

  assert.equal(induceGrammarPattern(examples.slice(0, 1)).status, "ambiguous");
  const contradiction = induceGrammarPattern([
    ...examples.slice(0, 2),
    {
      id: "contradiction",
      tokens: ["Sena", "dax", "lumo"],
      frame: { subject: "lumo", predicate: "dax", object: "Sena" },
    },
  ]);
  assert.equal(contradiction.status, "rejected");
  assert.equal(contradiction.pattern, null);

  const duplicated = induceGrammarPattern([
    examples[0],
    { ...examples[0], id: "duplicate-a" },
    { ...examples[0], id: "duplicate-b" },
  ]);
  assert.equal(duplicated.status, "ambiguous");
  assert.equal(duplicated.evidenceIds.length, 1);
  assert.equal(duplicated.confidence, 0.5);
});

test("pattern persistence survives reload, corruption is explicit, reset is isolated", async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, "pattern.json");
  const store = new GrammarPatternStore(filePath);
  const snapshot = induceGrammarPattern(examples);
  await store.write(snapshot);
  const reopened = await new GrammarPatternStore(filePath).read();
  assert.deepEqual(reopened?.pattern, snapshot.pattern);
  assert.deepEqual(reopened?.evidenceIds, snapshot.evidenceIds);

  await store.reset();
  assert.equal(await store.read(), null);
  await writeFile(filePath, "{broken", "utf8");
  await assert.rejects(store.read(), /Could not parse grammar-pattern store/);
  assert.equal(await readFile(filePath, "utf8"), "{broken");
  assert.throws(
    () => new GrammarPatternStore(new KnowledgeStore().getFilePath()),
    /cannot use FRIDAY's production memory path/,
  );
});

test("FRIDAY diagnostics expose an induced pattern only when TransInfant is enabled", async (t) => {
  const directory = await temporaryDirectory(t);
  const vocabularyStore = new KnowledgeStore(path.join(directory, "vocabulary.json"));
  const patternStore = new GrammarPatternStore(path.join(directory, "pattern.json"));
  await patternStore.write(induceGrammarPattern(examples));
  const entries: Array<[string, string, string, string]> = [
    ["mira", "word.mira", "meaning.mira", "Mira"],
    ["dax", "word.dax", "meaning.dax", "dax"],
    ["lumo", "word.lumo", "meaning.lumo", "lumo"],
  ];
  for (const [index, [surface, inputId, conceptId, label]] of entries.entries()) {
    const teaching: VocabularyExperience = {
      id: `friday-word-${index}`,
      source: "grammar-pattern-test",
      input: { id: inputId, kind: "word", surface },
      concept: { id: conceptId, label, semanticRole: index === 1 ? "predicate" : "entity" },
      confidence: 1,
      relationshipSource: "explicit",
    };
    await teachVocabulary(teaching, vocabularyStore);
  }

  clearSession("grammar-pattern-friday-on");
  const enabled = await understand("Mira dax lumo", "grammar-pattern-friday-on", {
    transinfantEnabled: true,
    transinfantStore: vocabularyStore,
    grammarPatternStore: patternStore,
    embeddingProvider: testEmbeddingProvider,
  });
  const diagnostics = enabled.context.transinfant as {
    grammarPattern: {
      status: string;
      frame: { subject: string; predicate: string; object: string } | null;
      source: string | null;
      provenance: string[];
      recognizedConcepts: string[];
      vocabularyProvenance: Array<{ relationshipId: string }>;
    };
  };
  assert.equal(diagnostics.grammarPattern.status, "supported");
  assert.deepEqual(diagnostics.grammarPattern.frame, {
    subject: "meaning.mira",
    predicate: "meaning.dax",
    object: "meaning.lumo",
  });
  assert.equal(diagnostics.grammarPattern.source, "induced");
  assert.deepEqual(diagnostics.grammarPattern.provenance, ["one", "three", "two"]);
  assert.deepEqual(diagnostics.grammarPattern.recognizedConcepts, [
    "meaning.mira",
    "meaning.dax",
    "meaning.lumo",
  ]);
  assert.equal(diagnostics.grammarPattern.vocabularyProvenance.length, 3);

  clearSession("grammar-pattern-friday-off");
  const disabled = await understand("Mira dax lumo", "grammar-pattern-friday-off", {
    transinfantEnabled: false,
    transinfantStore: vocabularyStore,
    grammarPatternStore: patternStore,
    embeddingProvider: testEmbeddingProvider,
  });
  assert.equal(
    (disabled.context.transinfant as { grammarPattern: { status: string } }).grammarPattern.status,
    "disabled",
  );
  assert.deepEqual(enabled.semantic, disabled.semantic);
});
