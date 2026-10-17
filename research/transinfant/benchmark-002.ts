import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { understand } from "../../src/nlu/friday";
import { KnowledgeStore } from "../../src/transinfant/memory-store";
import {
  inspectKnowledge,
  learnExperience,
  revertExperience,
} from "../../src/transinfant/learner";
import type {
  LearningExperience,
} from "../../src/transinfant/types";

interface EvaluationExample {
  id: string;
  text: string;
  category: string;
  expected: {
    action: string;
    object: string;
  };
}

interface EvaluationDataset {
  datasetId: string;
  curriculum: LearningExperience;
  development: EvaluationExample[];
  validation: EvaluationExample[];
  test: EvaluationExample[];
}

interface ConditionOutput {
  name: "A" | "B" | "C";
  descriptions: string[];
  factsAccess: string;
  training: Record<string, unknown>;
  development: ReturnType<typeof scoreRows>;
  validation: ReturnType<typeof scoreRows>;
  test: ReturnType<typeof scoreRows>;
  samples: Record<string, ScoredExample[]>;
  memoryBytes: number;
  timingMs: {
    p50: number;
    p95: number;
    sampleCount: number;
    repetitionsPerExample: number;
  };
}

interface ScoredExample {
  id: string;
  category: string;
  text: string;
  expected: { action: string; object: string };
  predicted: { action: string; object: string };
  exact: boolean;
  transinfantStatus: string;
  transinfantEvidence: string[];
}

const ROOT = process.cwd();
const DATASET_PATH = path.join(
  ROOT,
  "research",
  "transinfant",
  "datasets",
  "experiment-002.json",
);
const REPETITIONS = 5;

function percentile(values: number[], percent: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0;
}

function frame(action: string, object: string): string {
  return `${action}/${object}`;
}

function scoreRows(
  examples: EvaluationExample[],
  rows: ScoredExample[],
): Record<string, unknown> {
  const categories: Record<string, { count: number; correct: number }> = {};
  const confusion: Record<string, Record<string, number>> = {};
  let exact = 0;
  let falsePositiveFields = 0;
  let unknownExpectedFields = 0;
  let correctlyAbstained = 0;
  let allUnknownExpected = 0;

  for (const row of rows) {
    const category = categories[row.category] ?? { count: 0, correct: 0 };
    category.count++;
    if (row.exact) {
      exact++;
      category.correct++;
    }
    categories[row.category] = category;

    const expectedFrame = frame(row.expected.action, row.expected.object);
    const predictedFrame = frame(row.predicted.action, row.predicted.object);
    confusion[expectedFrame] ??= {};
    confusion[expectedFrame][predictedFrame] =
      (confusion[expectedFrame][predictedFrame] ?? 0) + 1;

    for (const field of ["action", "object"] as const) {
      if (row.expected[field] === "unknown") {
        unknownExpectedFields++;
        if (row.predicted[field] !== "unknown") {
          falsePositiveFields++;
        }
      }
    }
    if (
      row.expected.action === "unknown" &&
      row.expected.object === "unknown"
    ) {
      allUnknownExpected++;
      if (
        row.predicted.action === "unknown" &&
        row.predicted.object === "unknown"
      ) {
        correctlyAbstained++;
      }
    }
  }

  const perCategory = Object.fromEntries(
    Object.entries(categories).map(([name, counts]) => [
      name,
      {
        ...counts,
        accuracy: counts.count === 0 ? null : counts.correct / counts.count,
      },
    ]),
  );
  return {
    sampleCount: examples.length,
    exactActionObjectAccuracy: examples.length === 0 ? null : exact / examples.length,
    exactCorrect: exact,
    perCategory,
    confusionCounts: confusion,
    unsupportedInterpretationRate:
      unknownExpectedFields === 0
        ? null
        : falsePositiveFields / unknownExpectedFields,
    unsupportedFalsePositiveFields: falsePositiveFields,
    unknownExpectedFields,
    correctAbstentionRate:
      allUnknownExpected === 0 ? null : correctlyAbstained / allUnknownExpected,
    allUnknownCases: allUnknownExpected,
  };
}

async function loadDataset(): Promise<EvaluationDataset> {
  const parsed = JSON.parse(
    await readFile(DATASET_PATH, "utf8"),
  ) as EvaluationDataset;
  if (
    parsed.datasetId !== "friday-transinfant-tida-002-v1" ||
    !parsed.curriculum ||
    !Array.isArray(parsed.development) ||
    !Array.isArray(parsed.validation) ||
    !Array.isArray(parsed.test)
  ) {
    throw new Error("Experiment 002 dataset does not match the expected schema.");
  }
  return parsed;
}

async function evaluateSplit(
  condition: "A" | "B" | "C",
  examples: EvaluationExample[],
  store: KnowledgeStore,
  warm = false,
): Promise<{ rows: ScoredExample[]; timings: number[] }> {
  const mode = condition === "B" ? "retrieval" : "composition";
  const rows: ScoredExample[] = [];
  const timings: number[] = [];

  for (const example of examples) {
    const repetitions = warm ? REPETITIONS : 1;
    let result = await understand(
      example.text,
      `e002-${condition}-${example.id}-warmup`,
      {
        transinfantEnabled: condition !== "A",
        transinfantStore: store,
        transinfantMode: mode,
      },
    );

    for (let repetition = 0; repetition < repetitions; repetition++) {
      const start = performance.now();
      result = await understand(
        example.text,
        `e002-${condition}-${example.id}-${repetition}`,
        {
          transinfantEnabled: condition !== "A",
          transinfantStore: store,
          transinfantMode: mode,
        },
      );
      if (warm) {
        timings.push(performance.now() - start);
      }
    }

    const diagnostics = result.context.transinfant as {
      status: string;
      candidate: { evidence: string[] } | null;
    };
    const predicted = {
      action: result.semantic.action,
      object: result.semantic.object,
    };
    rows.push({
      id: example.id,
      category: example.category,
      text: example.text,
      expected: example.expected,
      predicted,
      exact:
        predicted.action === example.expected.action &&
        predicted.object === example.expected.object,
      transinfantStatus: diagnostics.status,
      transinfantEvidence: diagnostics.candidate?.evidence ?? [],
    });
  }
  return { rows, timings };
}

async function initializeCondition(
  condition: "A" | "B" | "C",
  dataset: EvaluationDataset,
  directory: string,
): Promise<{
  store: KnowledgeStore;
  training: Record<string, unknown>;
}> {
  const store = new KnowledgeStore(
    path.join(directory, `condition-${condition}.json`),
  );
  if (condition === "A") {
    return {
      store,
      training: {
        initializedClean: true,
        factsSuppliedToEngine: 0,
        rationale:
          "Original FRIDAY has no interface for injected relational facts; its TransInfant path is disabled.",
      },
    };
  }

  const result = await learnExperience(dataset.curriculum, store);
  const snapshot = await inspectKnowledge(store);
  return {
    store,
    training: {
      initializedClean: true,
      factsSuppliedToEngine: dataset.curriculum.relationships.length,
      acceptedFactCount: result.acceptedRelationshipIds.length,
      candidateFactCount: result.candidateRelationshipIds.length,
      rejectedFactCount: result.rejectedRelationshipIds.length,
      details: result.details,
      eventLog: snapshot.events.map((event) => ({
        experienceId: event.experienceId,
        outcome: event.outcome,
        details: event.details,
        addedRelationshipIds: event.addedRelationshipIds,
      })),
    },
  };
}

async function runCorrectionProtocol(directory: string): Promise<Record<string, unknown>> {
  const filePath = path.join(directory, "correction-protocol.json");
  const store = new KnowledgeStore(filePath);
  const entities = [
    { id: "invoke", label: "invoke" },
    { id: "open", label: "open" },
    { id: "show", label: "show" },
  ];

  const initial = await learnExperience(
    {
      id: "correction-initial",
      source: "explicit-teaching",
      entities,
      relationships: [
        {
          subject: "invoke",
          predicate: "equivalent-to",
          object: "open",
          source: "explicit",
        },
      ],
    },
    store,
  );
  const conflict = await learnExperience(
    {
      id: "correction-conflict",
      source: "unverified-explicit-observation",
      entities,
      relationships: [
        {
          subject: "invoke",
          predicate: "equivalent-to",
          object: "show",
          source: "explicit",
        },
      ],
    },
    store,
  );
  const correction = await learnExperience(
    {
      id: "correction-feedback",
      source: "user-correction",
      entities,
      relationships: [
        {
          subject: "invoke",
          predicate: "equivalent-to",
          object: "show",
          source: "feedback",
        },
      ],
    },
    store,
  );
  const afterCorrection = await inspectKnowledge(store);
  const activeAfterCorrection = afterCorrection.relationships
    .filter((relationship) => relationship.subject === "invoke")
    .map((relationship) => ({
      object: relationship.object,
      status: relationship.status,
      source: relationship.source,
    }));
  const duplicate = await learnExperience(
    {
      id: "correction-duplicate",
      source: "duplicate-observation",
      entities,
      relationships: [
        {
          subject: "invoke",
          predicate: "equivalent-to",
          object: "show",
          source: "explicit",
        },
      ],
    },
    store,
  );
  const relationshipCountAfterDuplicate =
    (await inspectKnowledge(store)).relationships.length;
  const reverted = await revertExperience("correction-feedback", store);
  const afterRevert = await inspectKnowledge(store);

  return {
    initialAccepted: initial.acceptedRelationshipIds.length,
    unsupportedConflictRejected: conflict.rejectedRelationshipIds.length,
    feedbackCorrectionAccepted: correction.acceptedRelationshipIds.length,
    activeAfterCorrection,
    duplicateReusedRelationship:
      duplicate.acceptedRelationshipIds.length === 1 &&
      relationshipCountAfterDuplicate === 2,
    reverted,
    originalRestored: afterRevert.relationships.some(
      (relationship) =>
        relationship.experienceId === "correction-initial" &&
        relationship.status === "accepted",
    ),
    eventLog: afterRevert.events.map((event) => ({
      experienceId: event.experienceId,
      outcome: event.outcome,
      details: event.details,
    })),
  };
}

async function main(): Promise<void> {
  const dataset = await loadDataset();
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "friday-transinfant-e002-"),
  );

  try {
    const conditions: ConditionOutput[] = [];
    for (const condition of ["A", "B", "C"] as const) {
      const { store, training } = await initializeCondition(
        condition,
        dataset,
        directory,
      );
      const development = await evaluateSplit(
        condition,
        dataset.development,
        store,
      );
      const validation = await evaluateSplit(
        condition,
        dataset.validation,
        store,
      );
      const test = await evaluateSplit(
        condition,
        dataset.test,
        store,
        true,
      );
      const filePath = path.join(directory, `condition-${condition}.json`);
      conditions.push({
        name: condition,
        descriptions: {
          A: ["Original FRIDAY baseline", "TransInfant disabled"],
          B: [
            "Same FRIDAY baseline plus at most one directly retrieved relation per utterance",
            "No joining of separate action and object relation evidence",
          ],
          C: [
            "Same FRIDAY baseline plus the current TransInfant compositional adapter",
            "Accepted action and object relations may jointly fill missing fields",
          ],
        }[condition],
        factsAccess:
          condition === "A"
            ? "No training facts consumed; original baseline has no compatible fact-ingestion API."
            : "All four curriculum relations, loaded through the same learner before evaluation.",
        training,
        development: scoreRows(dataset.development, development.rows),
        validation: scoreRows(dataset.validation, validation.rows),
        test: scoreRows(dataset.test, test.rows),
        samples: {
          development: development.rows,
          validation: validation.rows,
          test: test.rows,
        },
        memoryBytes: condition === "A" ? 0 : (await stat(filePath)).size,
        timingMs: {
          p50: Number(percentile(test.timings, 50).toFixed(3)),
          p95: Number(percentile(test.timings, 95).toFixed(3)),
          sampleCount: test.timings.length,
          repetitionsPerExample: REPETITIONS,
        },
      });
    }

    const conditionCStorePath = path.join(directory, "condition-C.json");
    const reloadStore = new KnowledgeStore(conditionCStorePath);
    const reloadRun = await evaluateSplit(
      "C",
      dataset.test,
      reloadStore,
    );
    const reloadScore = scoreRows(dataset.test, reloadRun.rows);
    const restartProbePath = path.join(
      ROOT,
      "research",
      "transinfant",
      "restart-probe.ts",
    );
    const tsxCliPath = path.join(
      ROOT,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );
    const child = spawnSync(
      process.execPath,
      [tsxCliPath, restartProbePath, conditionCStorePath, DATASET_PATH],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    if (child.error) {
      throw child.error;
    }
    if (child.status !== 0) {
      throw new Error(
        `Separate-process reload failed (${child.status}): ${child.stderr}`,
      );
    }
    const restartOutput = JSON.parse(child.stdout) as {
      rows: Array<{
        id: string;
        expected: { action: string; object: string };
        predicted: { action: string; object: string };
        exact: boolean;
      }>;
    };
    const restartRows: ScoredExample[] = restartOutput.rows.map((row) => {
      const example = dataset.test.find((candidate) => candidate.id === row.id);
      if (!example) {
        throw new Error(`Process restart returned unknown sample id ${row.id}.`);
      }
      return {
        ...row,
        category: example.category,
        text: example.text,
        transinfantStatus: "process-restarted",
        transinfantEvidence: [],
      };
    });
    const processRestartScore = scoreRows(dataset.test, restartRows);
    await reloadStore.reset();
    const resetRun = await evaluateSplit(
      "C",
      dataset.test,
      reloadStore,
    );
    const resetScore = scoreRows(dataset.test, resetRun.rows);

    const correction = await runCorrectionProtocol(directory);
    const result = {
      experimentId: "TIDA-002",
      datasetId: dataset.datasetId,
      benchmarkVersion: "friday-transinfant-controlled-eval-002-v1",
      runDate: new Date().toISOString(),
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
      },
      runtime: process.version,
      seed: null,
      seedExplanation: "All records are fixed hand-authored examples; no sampling.",
      exactCommands: [
        "npm run typecheck",
        "npm run build",
        "npm test",
        "npm run benchmark:transinfant:002",
      ],
      splitSizes: {
        trainingConcepts: dataset.curriculum.entities.length,
        trainingRelations: dataset.curriculum.relationships.length,
        development: dataset.development.length,
        validation: dataset.validation.length,
        test: dataset.test.length,
      },
      leakageControls: {
        evaluationExamplesIngested: false,
        testFactsInserted: false,
        conditionsBAndCReceiveSameCurriculum: true,
        heldOutUsedForParameterTuning: false,
      },
      metricDefinitions: {
        exactActionObjectAccuracy:
          "Count with both predicted action and object equal to expected values, divided by sample count.",
        unsupportedInterpretationRate:
          "False positive predicted fields divided by fields whose expected value is unknown.",
        correctAbstentionRate:
          "All-unknown predictions divided by cases whose expected action and object are both unknown.",
        categoryAccuracy:
          "Exact action/object accuracy computed separately for each predeclared category.",
        confusionCounts:
          "Counts of predicted action/object frames per expected action/object frame.",
        latency:
          `Warm full understand() latency; ${REPETITIONS} repetitions for each held-out test item; p50 and nearest-rank p95.`,
      },
      conditions,
      persistenceProtocol: {
        storageReload: {
          method: "Separate Node.js/tsx process reopened the persisted C store and replayed all held-out test items.",
          test: reloadScore,
          processRestartTest: processRestartScore,
          exactMatchWithCInProcessReload:
            JSON.stringify(reloadRun.rows.map((row) => row.predicted)) ===
            JSON.stringify(
              conditions.find((condition) => condition.name === "C")
                ?.samples.test.map((row) => row.predicted),
            ),
          exactMatchWithCProcessRestart:
            JSON.stringify(restartRows.map((row) => row.predicted)) ===
            JSON.stringify(
              conditions.find((condition) => condition.name === "C")
                ?.samples.test.map((row) => row.predicted),
            ),
        },
        afterReset: resetScore,
        correctionAndDuplicateProtocol: correction,
      },
    };

    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile(
      path.join(ROOT, "research", "transinfant", "results-002.json"),
      serialized,
      "utf8",
    );
    process.stdout.write(serialized);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("Experiment 002 benchmark failed:", error);
  process.exitCode = 1;
});
