import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { KnowledgeStore } from "../../src/transinfant/memory-store";
import {
  composeWithVocabulary,
  exportVocabularySnapshot,
  queryVocabulary,
  resetVocabularyMemory,
  teachVocabulary,
  type CompositionResult,
  type SuppliedCompositionRule,
  type VocabularyExperience,
  type VocabularyQueryResult,
} from "../../src/transinfant/vocabulary-learning";
import { revertExperience } from "../../src/transinfant/learner";

interface EvaluationExample {
  id: string;
  task: "recognition" | "lookup" | "compose";
  kind?: "symbol" | "word";
  input: string;
  category: string;
  expected: Record<string, unknown>;
}

interface Dataset {
  datasetId: string;
  development: EvaluationExample[];
  validation: EvaluationExample[];
  test: EvaluationExample[];
}

interface TeachingDataset {
  datasetId: string;
  teaching: TeachingRecord[];
}

interface TeachingRecord {
  experienceId: string;
  kind: "symbol" | "word";
  inputEntityId: string;
  surface: string;
  aliases: string[];
  conceptId: string;
  conceptLabel: string;
  semanticRole: "entity" | "predicate" | "property";
  definition: string | null;
  exampleUsage: string | null;
  source: string;
  relationshipSource: "explicit" | "feedback" | "inferred";
  timestamp: string;
  confidence: number;
}

interface ScoredExample {
  id: string;
  task: EvaluationExample["task"];
  category: string;
  input: string;
  expected: Record<string, unknown>;
  predicted: Record<string, unknown>;
  exact: boolean;
  evidence: unknown[];
}

interface ConditionResult {
  name: "A" | "B" | "C";
  description: string;
  trainingFacts: number;
  candidateFacts: number;
  rejectedFacts: number;
  trainingEvents: Array<Record<string, unknown>>;
  memoryBytes: number;
  development: ReturnType<typeof scoreRows>;
  validation: ReturnType<typeof scoreRows>;
  test: ReturnType<typeof scoreRows>;
  samples: Record<string, ScoredExample[]>;
  latencyMs: {
    sampleCount: number;
    timedExampleCount: number;
    repetitionsPerTestExample: number;
    p50: number;
    p95: number;
  };
}

const ROOT = process.cwd();
const TRANSINFANT_ROOT = path.join(ROOT, "research", "transinfant");
const TEACHING_PATH = path.join(
  TRANSINFANT_ROOT,
  "datasets",
  "experiment-003-teaching.json",
);
const EVALUATION_PATH = path.join(
  TRANSINFANT_ROOT,
  "datasets",
  "experiment-003-evaluation.json",
);
const RULE: SuppliedCompositionRule = {
  id: "supplied-svo-v1",
  tokenCount: 3,
  roles: ["entity", "predicate", "entity"],
  outputSlots: ["subject", "predicate", "object"],
};
const TIMING_REPETITIONS = 5;

function percentile(values: number[], percent: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0;
}

function exactValue(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function scoreRows(
  examples: EvaluationExample[],
  rows: ScoredExample[],
): Record<string, unknown> {
  const byCategory: Record<string, { count: number; correct: number }> = {};
  const confusionCounts: Record<string, Record<string, number>> = {};
  let correct = 0;
  for (const row of rows) {
    const counts = byCategory[row.category] ?? { count: 0, correct: 0 };
    counts.count++;
    if (row.exact) {
      counts.correct++;
      correct++;
    }
    byCategory[row.category] = counts;
    const expectedKey = JSON.stringify(row.expected);
    const actualKey = JSON.stringify(row.predicted);
    confusionCounts[expectedKey] ??= {};
    confusionCounts[expectedKey][actualKey] =
      (confusionCounts[expectedKey][actualKey] ?? 0) + 1;
  }

  return {
    sampleCount: examples.length,
    exactCorrect: correct,
    exactAccuracy: examples.length === 0 ? null : correct / examples.length,
    perCategory: Object.fromEntries(
      Object.entries(byCategory).map(([category, counts]) => [
        category,
        {
          ...counts,
          accuracy: counts.count === 0 ? null : counts.correct / counts.count,
        },
      ]),
    ),
    confusionCounts,
  };
}

async function loadJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function toVocabularyExperience(record: TeachingRecord): VocabularyExperience {
  return {
    id: record.experienceId,
    source: record.source,
    timestamp: record.timestamp,
    input: {
      id: record.inputEntityId,
      kind: record.kind,
      surface: record.surface,
      aliases: record.aliases,
    },
    concept: {
      id: record.conceptId,
      label: record.conceptLabel,
      semanticRole: record.semanticRole,
      definition: record.definition ?? undefined,
    },
    exampleUsage: record.exampleUsage ?? undefined,
    confidence: record.confidence,
    relationshipSource: record.relationshipSource,
  };
}

async function runExample(
  condition: "A" | "B" | "C",
  example: EvaluationExample,
  store: KnowledgeStore,
): Promise<ScoredExample> {
  let predicted: Record<string, unknown>;
  let evidence: unknown[] = [];
  if (example.task === "recognition") {
    const result: VocabularyQueryResult = await queryVocabulary(
      example.kind!,
      example.input,
      store,
    );
    predicted = { recognized: result.recognized };
    evidence = result.provenance;
  } else if (example.task === "lookup") {
    const result: VocabularyQueryResult = await queryVocabulary(
      example.kind!,
      example.input,
      store,
    );
    predicted =
      result.status === "supported"
        ? { status: result.status, conceptId: result.concept?.id }
        : { status: result.status };
    evidence = result.provenance;
  } else {
    const result: CompositionResult = await composeWithVocabulary(
      example.input,
      RULE,
      store,
      condition === "C",
    );
    predicted = result.frame
      ? { status: result.status, ...result.frame }
      : { status: result.status };
    evidence = result.evidence;
  }

  return {
    id: example.id,
    task: example.task,
    category: example.category,
    input: example.input,
    expected: example.expected,
    predicted,
    exact: exactValue(predicted, example.expected),
    evidence,
  };
}

async function teachCurriculum(
  condition: "A" | "B" | "C",
  teaching: VocabularyExperience[],
  store: KnowledgeStore,
): Promise<{
  acceptedFactCount: number;
  candidateFactCount: number;
  rejectedFactCount: number;
  events: Array<Record<string, unknown>>;
}> {
  if (condition === "A") {
    return {
      acceptedFactCount: 0,
      candidateFactCount: 0,
      rejectedFactCount: 0,
      events: [],
    };
  }

  const events: Array<Record<string, unknown>> = [];
  let acceptedFactCount = 0;
  let candidateFactCount = 0;
  let rejectedFactCount = 0;
  for (const experience of teaching) {
    const result = await teachVocabulary(experience, store);
    acceptedFactCount += result.acceptedRelationshipIds.length;
    candidateFactCount += result.candidateRelationshipIds.length;
    rejectedFactCount += result.rejectedRelationshipIds.length;
    events.push({
      experienceId: experience.id,
      source: experience.source,
      accepted: result.accepted,
      acceptedRelationshipIds: result.acceptedRelationshipIds,
      candidateRelationshipIds: result.candidateRelationshipIds,
      rejectedRelationshipIds: result.rejectedRelationshipIds,
      details: result.details,
    });
  }
  return {
    acceptedFactCount,
    candidateFactCount,
    rejectedFactCount,
    events,
  };
}

async function runCondition(
  condition: "A" | "B" | "C",
  teaching: VocabularyExperience[],
  dataset: Dataset,
  directory: string,
): Promise<{ result: ConditionResult; storePath: string }> {
  const storePath = path.join(directory, `condition-${condition}.json`);
  const store = new KnowledgeStore(storePath);
  const training = await teachCurriculum(condition, teaching, store);
  const splits: Array<[string, EvaluationExample[]]> = [
    ["development", dataset.development],
    ["validation", dataset.validation],
    ["test", dataset.test],
  ];
  const samples: Record<string, ScoredExample[]> = {};
  const scored: Record<string, Record<string, unknown>> = {};
  for (const [name, examples] of splits) {
    const rows: ScoredExample[] = [];
    for (const example of examples) {
      rows.push(await runExample(condition, example, store));
    }
    samples[name] = rows;
    scored[name] = scoreRows(examples, rows);
  }

  const timings: number[] = [];
  const timedExamples =
    condition === "C"
      ? dataset.test
      : dataset.test.filter((example) => example.task !== "compose");
  for (const example of timedExamples) {
    for (let repetition = 0; repetition < TIMING_REPETITIONS; repetition++) {
      const start = performance.now();
      await runExample(condition, example, store);
      timings.push(performance.now() - start);
    }
  }
  let memoryBytes = 0;
  try {
    memoryBytes = (await stat(storePath)).size;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  return {
    storePath,
    result: {
      name: condition,
      description:
        condition === "A"
          ? "Empty store; no taught associations and no composition."
          : condition === "B"
            ? "Same taught associations as C; exact retrieval only, no composition."
            : "Same taught associations as B; exact retrieval plus supplied SVO role rule.",
      trainingFacts: training.acceptedFactCount,
      candidateFacts: training.candidateFactCount,
      rejectedFacts: training.rejectedFactCount,
      trainingEvents: training.events,
      memoryBytes,
      development: scored.development as ReturnType<typeof scoreRows>,
      validation: scored.validation as ReturnType<typeof scoreRows>,
      test: scored.test as ReturnType<typeof scoreRows>,
      samples,
      latencyMs: {
        sampleCount: timings.length,
        timedExampleCount: timedExamples.length,
        repetitionsPerTestExample: TIMING_REPETITIONS,
        p50: percentile(timings, 50),
        p95: percentile(timings, 95),
      },
    },
  };
}

function experienceFrom(
  item: VocabularyExperience,
  overrides: Partial<VocabularyExperience>,
): VocabularyExperience {
  return { ...item, ...overrides };
}

async function runCorrectionProtocol(
  teaching: VocabularyExperience[],
  directory: string,
): Promise<Record<string, unknown>> {
  const store = new KnowledgeStore(path.join(directory, "correction.json"));
  const initial = teaching.find((item) => item.id === "teach-symbol-C-v1");
  const unrelated = teaching.find((item) => item.id === "teach-word-cat-v1");
  const unrelatedSymbol = teaching.find((item) => item.id === "teach-symbol-B-v1");
  const dog = teaching.find((item) => item.id === "teach-word-dog-v1");
  if (!initial || !unrelated || !unrelatedSymbol || !dog) {
    throw new Error("Correction protocol could not find required curriculum facts.");
  }
  await teachVocabulary(initial, store);
  await teachVocabulary(unrelated, store);
  await teachVocabulary(unrelatedSymbol, store);

  const conflict = await teachVocabulary(
    experienceFrom(initial, {
      id: "correction-unverified-conflict",
      source: "unverified-conflict",
      timestamp: "2026-10-16T07:20:00.000Z",
      concept: { ...dog.concept },
      relationshipSource: "explicit",
    }),
    store,
  );
  const beforeFeedback = await queryVocabulary("symbol", "C", store);
  const feedback = await teachVocabulary(
    experienceFrom(initial, {
      id: "correction-user-feedback",
      source: "user-feedback",
      timestamp: "2026-10-16T07:21:00.000Z",
      concept: { ...dog.concept },
      relationshipSource: "feedback",
    }),
    store,
  );
  const corrected = await queryVocabulary("symbol", "C", store);
  const wordUnchanged = await queryVocabulary("word", "cat", store);
  const symbolUnchanged = await queryVocabulary("symbol", "B", store);
  const revisionHistoryAfterCorrection = (await store.read()).relationships
    .filter((relation) => relation.subject === initial.input.id)
    .map((relation) => ({
      experienceId: relation.experienceId,
      object: relation.object,
      status: relation.status,
      source: relation.source,
      timestamp: relation.timestamp,
    }));
  const reverted = await revertExperience("correction-user-feedback", store);
  const restored = await queryVocabulary("symbol", "C", store);
  const revisionHistoryAfterRevert = (await store.read()).relationships
    .filter((relation) => relation.subject === initial.input.id)
    .map((relation) => ({
      experienceId: relation.experienceId,
      object: relation.object,
      status: relation.status,
      source: relation.source,
      timestamp: relation.timestamp,
    }));

  return {
    conflictRejected: conflict.rejectedRelationshipIds.length === 1,
    oldAssociationBeforeCorrection: beforeFeedback.concept?.id,
    feedbackAccepted: feedback.acceptedRelationshipIds.length === 1,
    correctedConcept: corrected.concept?.id,
    revisionHistoryAfterCorrection,
    unrelatedWordRetained: wordUnchanged.concept?.id === "meaning.cat",
    unrelatedSymbolRetained: symbolUnchanged.concept?.id === "meaning.dog",
    correctionReverted: reverted,
    originalAssociationRestored: restored.concept?.id === "meaning.apple",
    revisionHistoryAfterRevert,
    passed:
      conflict.rejectedRelationshipIds.length === 1 &&
      beforeFeedback.concept?.id === "meaning.apple" &&
      feedback.acceptedRelationshipIds.length === 1 &&
      corrected.concept?.id === "meaning.dog" &&
      wordUnchanged.concept?.id === "meaning.cat" &&
      symbolUnchanged.concept?.id === "meaning.dog" &&
      reverted &&
      restored.concept?.id === "meaning.apple",
  };
}

async function runDuplicateProtocol(
  teaching: VocabularyExperience[],
  store: KnowledgeStore,
): Promise<Record<string, unknown>> {
  const original = teaching.find((item) => item.id === "teach-word-cat-v1");
  if (!original) {
    throw new Error("Duplicate protocol could not find the cat teaching example.");
  }
  const before = await store.read();
  const duplicate = await teachVocabulary(
    experienceFrom(original, {
      id: "duplicate-word-cat-v1",
      source: "duplicate-teaching",
      timestamp: "2026-10-16T07:10:00.000Z",
    }),
    store,
  );
  const after = await store.read();
  const acceptedForInput = after.relationships.filter(
    (relation) =>
      relation.subject === original.input.id &&
      relation.predicate === "denotes" &&
      relation.status === "accepted",
  );
  return {
    duplicateReusedExistingRelationship:
      duplicate.acceptedRelationshipIds.length === 1 &&
      before.relationships.length === after.relationships.length &&
      acceptedForInput.length === 1,
    acceptedRelationshipIds: duplicate.acceptedRelationshipIds,
    relationshipCountBefore: before.relationships.length,
    relationshipCountAfter: after.relationships.length,
    passed:
      duplicate.acceptedRelationshipIds.length === 1 &&
      before.relationships.length === after.relationships.length &&
      acceptedForInput.length === 1,
  };
}

async function runResetProtocol(
  teaching: VocabularyExperience[],
  directory: string,
): Promise<Record<string, unknown>> {
  const store = new KnowledgeStore(path.join(directory, "reset.json"));
  const word = teaching.find((item) => item.id === "teach-word-cat-v1");
  const symbol = teaching.find((item) => item.id === "teach-symbol-A-v1");
  if (!word || !symbol) {
    throw new Error("Reset protocol could not find required curriculum facts.");
  }
  await teachVocabulary(word, store);
  await teachVocabulary(symbol, store);
  const before = {
    word: await queryVocabulary("word", "cat", store),
    symbol: await queryVocabulary("symbol", "A", store),
  };
  await resetVocabularyMemory(store);
  const after = {
    word: await queryVocabulary("word", "cat", store),
    symbol: await queryVocabulary("symbol", "A", store),
  };
  return {
    knownBeforeReset:
      before.word.status === "supported" && before.symbol.status === "supported",
    unknownAfterReset:
      after.word.status === "unknown" &&
      after.symbol.status === "unknown" &&
      !after.word.recognized &&
      !after.symbol.recognized,
    relationshipsAfterReset: (await store.read()).relationships.length,
    passed:
      before.word.status === "supported" &&
      before.symbol.status === "supported" &&
      after.word.status === "unknown" &&
      after.symbol.status === "unknown" &&
      !after.word.recognized &&
      !after.symbol.recognized,
  };
}

async function runCorruptionProtocol(directory: string): Promise<Record<string, unknown>> {
  const filePath = path.join(directory, "corrupt.json");
  const store = new KnowledgeStore(filePath);
  const corruptContents = "{not-valid-json";
  await writeFile(filePath, corruptContents, "utf8");
  let readFailure = "";
  try {
    await queryVocabulary("word", "cat", store);
  } catch (error) {
    readFailure = error instanceof Error ? error.message : String(error);
  }
  const filePreserved = (await readFile(filePath, "utf8")) === corruptContents;
  return {
    rejectedCorruptMemory: readFailure.includes("Could not parse"),
    originalBytesPreserved: filePreserved,
    failure: readFailure,
    passed: readFailure.includes("Could not parse") && filePreserved,
  };
}

async function runProductionStoreGuard(): Promise<Record<string, unknown>> {
  let failure = "";
  try {
    await resetVocabularyMemory(new KnowledgeStore());
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  return {
    defaultProductionStoreResetBlocked:
      failure.includes("production TransInfant store is protected"),
    failure,
    passed: failure.includes("production TransInfant store is protected"),
  };
}

async function runRestartProbe(
  storePath: string,
): Promise<Record<string, unknown>> {
  const probePath = path.join(TRANSINFANT_ROOT, "restart-probe-003.ts");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", probePath, storePath],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (child.error) {
    throw child.error;
  }
  if (child.status !== 0) {
    throw new Error(
      `Separate-process reload failed with exit ${child.status}: ${child.stderr}`,
    );
  }
  const output = JSON.parse(child.stdout.trim()) as {
    word: VocabularyQueryResult;
    symbol: VocabularyQueryResult;
    composition: CompositionResult;
  };
  return {
    separateProcessExitCode: child.status,
    probes: {
      wordConcept: output.word.concept?.id ?? null,
      symbolConcept: output.symbol.concept?.id ?? null,
      novelComposition: output.composition.frame,
    },
    passed:
      output.word.status === "supported" &&
      output.word.concept?.id === "meaning.cat" &&
      output.symbol.status === "supported" &&
      output.symbol.concept?.id === "meaning.dog" &&
      output.composition.status === "supported" &&
      output.composition.frame?.subject === "meaning.dog" &&
      output.composition.frame?.predicate === "meaning.see" &&
      output.composition.frame?.object === "meaning.cat",
  };
}

function aggregateMetrics(condition: ConditionResult): Record<string, unknown> {
  const rows = condition.samples.test;
  const category = (name: string) =>
    rows.filter((row) => row.category === name);
  const exactRate = (subset: ScoredExample[]) =>
    subset.length === 0
      ? null
      : subset.filter((row) => row.exact).length / subset.length;
  const unsupported = category("unsupported-role-sequence");
  const unknown = category("unknown-word");
  const ambiguous = category("ambiguous-association");

  return {
    symbolRecognitionAccuracy: exactRate(category("symbol-recognition")),
    symbolRecognitionDenominator: category("symbol-recognition").length,
    symbolToConceptAccuracy: exactRate(category("symbol-to-concept")),
    symbolToConceptDenominator: category("symbol-to-concept").length,
    wordToConceptAccuracy: exactRate(category("word-to-concept")),
    wordToConceptDenominator: category("word-to-concept").length,
    seenUsageAccuracy: exactRate(category("previously-seen-usage")),
    seenUsageDenominator: category("previously-seen-usage").length,
    unseenCombinationAccuracy: exactRate(category("unseen-known-combination")),
    unseenCombinationDenominator: category("unseen-known-combination").length,
    unknownItemRejectionAccuracy: exactRate(unknown),
    unknownItemDenominator: unknown.length,
    ambiguityHandlingAccuracy: exactRate(ambiguous),
    ambiguityDenominator: ambiguous.length,
    unsupportedInferenceRate:
      unsupported.length === 0
        ? null
        : unsupported.filter((row) => row.predicted.status === "supported")
            .length / unsupported.length,
    unsupportedInferenceDenominator: unsupported.length,
    exactAccuracyAllTestCases: condition.test.exactAccuracy,
    exactAccuracyDenominator: condition.test.sampleCount,
  };
}

async function main(): Promise<void> {
  const teachingDataset = await loadJson<TeachingDataset>(TEACHING_PATH);
  const teaching = teachingDataset.teaching.map(toVocabularyExperience);
  const evaluationDataset = await loadJson<Dataset>(EVALUATION_PATH);
  const allTestInputs = new Set(
    evaluationDataset.test.map((example) => example.input.toLocaleLowerCase()),
  );
  const curriculumUsage = teachingDataset.teaching
    .map((item) => item.exampleUsage?.toLocaleLowerCase())
    .filter((item): item is string => Boolean(item));
  if (allTestInputs.size !== evaluationDataset.test.length) {
    throw new Error("Held-out test inputs must have unique identifiers/strings.");
  }
  const novelExamples = evaluationDataset.test.filter(
    (item) => item.category === "unseen-known-combination",
  );
  if (
    novelExamples.some((example) =>
      curriculumUsage.includes(example.input.toLocaleLowerCase()),
    )
  ) {
    throw new Error("An unseen-combination test duplicates a supplied usage example.");
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "friday-tida-003-"));
  try {
    const conditions = [];
    let conditionCStorePath = "";
    for (const name of ["A", "B", "C"] as const) {
      const condition = await runCondition(
        name,
        teaching,
        evaluationDataset,
        directory,
      );
      conditions.push(condition.result);
      if (name === "C") {
        conditionCStorePath = condition.storePath;
      }
    }
    const conditionC = conditions.find((item) => item.name === "C");
    const conditionB = conditions.find((item) => item.name === "B");
    if (!conditionC || !conditionB) {
      throw new Error("Required matched comparison conditions were not run.");
    }

    const persistenceStore = new KnowledgeStore(conditionCStorePath);
    const exportedSnapshot = await exportVocabularySnapshot(persistenceStore);
    const parsedSnapshot = JSON.parse(exportedSnapshot) as {
      relationships: Array<{ status: string }>;
      events: unknown[];
    };
    const duplicate = await runDuplicateProtocol(
      teaching,
      persistenceStore,
    );
    const restart = await runRestartProbe(conditionCStorePath);
    const correction = await runCorrectionProtocol(
      teaching,
      directory,
    );
    const reset = await runResetProtocol(    teaching, directory);
    const corruption = await runCorruptionProtocol(directory);
    const productionMemoryGuard = await runProductionStoreGuard();
    const integrityChecks = [
      { name: "snapshot-export-parses", passed: parsedSnapshot.relationships.length > 0 },
      { name: "duplicate-does-not-add-association", passed: duplicate.passed },
      { name: "separate-process-reload", passed: restart.passed },
      { name: "correction-preserves-unrelated-knowledge", passed: correction.passed },
      { name: "isolated-reset-forgets-knowledge", passed: reset.passed },
      { name: "corrupt-memory-is-preserved-and-rejected", passed: corruption.passed },
      { name: "production-memory-reset-is-blocked", passed: productionMemoryGuard.passed },
    ];
    const snapshotPath = path.join(
      TRANSINFANT_ROOT,
      "memory-snapshot-003.json",
    );
    await writeFile(snapshotPath, exportedSnapshot, "utf8");
    const result = {
      experimentId: "TIDA-003",
      experimentVersion: "friday-transinfant-tida-003-v1",
      teachingDatasetId: teachingDataset.datasetId,
      evaluationDatasetId: evaluationDataset.datasetId,
      runDate: new Date().toISOString(),
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      exactCommands: [
        "npm run typecheck",
        "npm test",
        "npm run build",
        "npm run benchmark:transinfant:003",
      ],
      randomization: {
        used: false,
        seed: null,
        explanation: "Fixed hand-authored datasets; no randomized sampling.",
      },
      datasetSizes: {
        explicitTeachingExperiences:         teaching.filter(
          (item) => item.relationshipSource !== "inferred",
        ).length,
        inferredCandidateExperiences: teaching.filter(
          (item) => item.relationshipSource === "inferred",
        ).length,
        distinctWordAndSymbolInputs: new Set(
          teaching.map(
            (item) => `${item.input.kind}:${item.input.surface.toLocaleLowerCase()}`,
          ),
        ).size,
        development: evaluationDataset.development.length,
        validation: evaluationDataset.validation.length,
        test: evaluationDataset.test.length,
        testCategories: Object.fromEntries(
          [...new Set(evaluationDataset.test.map((item) => item.category))].map(
            (category) => [
              category,
              evaluationDataset.test.filter((item) => item.category === category).length,
            ],
          ),
        ),
      },
      leakageControls: {
        testExamplesSuppliedToLearner: false,
        expectedOutputsSuppliedToLearner: false,
        onlyCurriculumEntriesTaught: true,
        seenUsageStringsAreMetadataOnly: true,
        novelTestCombinationsAreNotTeachingExamples: true,
      },
      compositionRule: {
        ...RULE,
        supplied: true,
        acquiredFromExamples: false,
      },
      conditions,
      metrics: Object.fromEntries(
        conditions.map((condition) => [
          condition.name,
          aggregateMetrics(condition),
        ]),
      ),
      persistenceAndLearningIntegrity: {
        exportedSnapshot: {
          validJson: true,
          path: "research/transinfant/memory-snapshot-003.json",
          relationshipCount: parsedSnapshot.relationships.length,
          learningEventCount: parsedSnapshot.events.length,
        },
        duplicate,
        restart,
        correction,
        reset,
        corruptMemory: corruption,
        productionMemoryGuard,
        integrityChecks,
        failedIntegrityChecks: integrityChecks
          .filter((check) => !check.passed)
          .map((check) => check.name),
      },
      matchedInformationComparison: {
        BAndCReceivedSameTeachingDataset: true,
        BTrainingEventCount: conditionB.trainingEvents.length,
        CTrainingEventCount: conditionC.trainingEvents.length,
        onlyCReceivesCompositionRule: true,
        note: "A is untrained; B/C are matched on explicit associations. C's rule is supplied, not induced.",
      },
    };
    const output = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(
      path.join(TRANSINFANT_ROOT, "results-003.json"),
      output,
      "utf8",
    );
    process.stdout.write(output);
    if (integrityChecks.some((check) => !check.passed)) {
      process.exitCode = 1;
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("TIDA-003 benchmark failed:", error);
  process.exitCode = 1;
});
