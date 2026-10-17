import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorDetails } from "../../src/error-details";
import { clearSession } from "../../src/nlu/context-engine";
import { understand } from "../../src/nlu/friday";
import { getEmbeddingModelStatus } from "../../src/ml/embedding.engine";
import type { NLUResult, SemanticAction, SemanticObject } from "../../src/types/nlu";
import { createIntelligenceContract } from "../../src/types/intelligence-contract";

type EvaluationKind =
  | "command"
  | "incomplete"
  | "spelling_error"
  | "negated"
  | "ambiguous"
  | "out_of_domain";

interface EvaluationCase {
  id: string;
  text: string;
  expectedIntent: string;
  expectedAction: SemanticAction;
  expectedObject: SemanticObject;
  expectedEntityValue?: string;
  kind: EvaluationKind;
}

interface Dataset {
  datasetVersion: string;
  cases: EvaluationCase[];
}

interface Prediction {
  testCase: EvaluationCase;
  result: NLUResult;
  durationMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectedWorkspaceEntity(text: string): string | undefined {
  const canonicalBySurface: Record<string, string> = {
    document: "document",
    documents: "document",
    spreadsheet: "spreadsheet",
    spreadsheets: "spreadsheet",
    presentation: "presentation",
    presentations: "presentation",
    note: "note",
    notes: "note",
    file: "file",
    files: "file",
    folder: "folder",
    folders: "folder",
  };
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.map((token) => canonicalBySurface[token]).find(Boolean);
}

function loadDataset(value: unknown): Dataset {
  if (
    !isRecord(value) ||
    typeof value.datasetVersion !== "string" ||
    !Array.isArray(value.cases)
  ) {
    throw new TypeError("FRIDAY evaluation dataset has an invalid top-level schema.");
  }
  const cases = value.cases as unknown[];
  const ids = new Set<string>();
  for (const [index, item] of cases.entries()) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      typeof item.expectedIntent !== "string" ||
      typeof item.expectedAction !== "string" ||
      typeof item.expectedObject !== "string" ||
      typeof item.kind !== "string" ||
      (item.expectedEntityValue !== undefined &&
        typeof item.expectedEntityValue !== "string")
    ) {
      throw new TypeError(`FRIDAY evaluation case ${index} is invalid.`);
    }
    const expectedActions = [
      "create", "open", "search", "show", "delete", "remove", "rename",
      "edit", "close", "unknown",
    ];
    const expectedObjects = [
      "document", "spreadsheet", "presentation", "note", "file", "folder",
      "application", "report", "project", "unknown",
    ];
    const expectedKinds: EvaluationKind[] = [
      "command", "incomplete", "spelling_error", "negated", "ambiguous",
      "out_of_domain",
    ];
    if (
      ids.has(item.id) ||
      !expectedActions.includes(item.expectedAction) ||
      !expectedObjects.includes(item.expectedObject) ||
      !(
        item.expectedIntent === "unknown" ||
        item.expectedIntent.startsWith("workspace.")
      ) ||
      !expectedKinds.includes(item.kind as EvaluationKind)
    ) {
      throw new TypeError(`FRIDAY evaluation case ${index} has invalid labels or a duplicate id.`);
    }
    ids.add(item.id);
    if (item.expectedEntityValue !== expectedWorkspaceEntity(item.text)) {
      throw new TypeError(
        `FRIDAY evaluation case ${index} has an incorrect workspace-object entity label.`,
      );
    }
  }
  return {
    datasetVersion: value.datasetVersion,
    cases: cases as EvaluationCase[],
  };
}

function scoreLabel(
  predictions: Prediction[],
  expected: (item: EvaluationCase) => string,
  actual: (item: Prediction) => string,
): { accuracy: number; macroF1: number; byLabel: Record<string, unknown> } {
  const labels = new Set(predictions.flatMap((item) => [
    expected(item.testCase),
    actual(item),
  ]));
  const byLabel: Record<string, unknown> = {};
  let f1Total = 0;
  for (const label of labels) {
    const truePositive = predictions.filter(
      (item) => expected(item.testCase) === label && actual(item) === label,
    ).length;
    const falsePositive = predictions.filter(
      (item) => expected(item.testCase) !== label && actual(item) === label,
    ).length;
    const falseNegative = predictions.filter(
      (item) => expected(item.testCase) === label && actual(item) !== label,
    ).length;
    const precision = truePositive + falsePositive === 0
      ? 0
      : truePositive / (truePositive + falsePositive);
    const recall = truePositive + falseNegative === 0
      ? 0
      : truePositive / (truePositive + falseNegative);
    const f1 = precision + recall === 0
      ? 0
      : 2 * precision * recall / (precision + recall);
    byLabel[label] = {
      precision,
      recall,
      f1,
      support: truePositive + falseNegative,
    };
    f1Total += f1;
  }
  return {
    accuracy: predictions.length === 0
      ? 0
      : predictions.filter(
          (item) => expected(item.testCase) === actual(item),
        ).length / predictions.length,
    macroF1: labels.size === 0 ? 0 : f1Total / labels.size,
    byLabel,
  };
}

function quantile(values: number[], quantileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(quantileValue * sorted.length) - 1,
  );
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const datasetPath = path.join(__dirname, "datasets", "intent-v1.json");
  const bytes = await readFile(datasetPath);
  const dataset = loadDataset(JSON.parse(bytes.toString("utf8")) as unknown);
  const predictions: Prediction[] = [];

  for (const testCase of dataset.cases) {
    const sessionId = `friday-benchmark-${testCase.id}`;
    clearSession(sessionId);
    const startedAt = performance.now();
    const result = await understand(testCase.text, sessionId, {
      transinfantEnabled: false,
    });
    const durationMs = performance.now() - startedAt;
    predictions.push({ testCase, result, durationMs });
  }

  const intent = scoreLabel(
    predictions,
    (item) => item.expectedIntent,
    (item) => item.result.intent.name,
  );
  const action = scoreLabel(
    predictions,
    (item) => item.expectedAction,
    (item) => item.result.semantic.action,
  );
  const object = scoreLabel(
    predictions,
    (item) => item.expectedObject,
    (item) => item.result.semantic.object,
  );
  const fullyCorrect = predictions.filter(
    ({ testCase, result }) =>
      testCase.expectedIntent === result.intent.name &&
      testCase.expectedAction === result.semantic.action &&
      testCase.expectedObject === result.semantic.object,
  ).length;
  const entityCounts = predictions.reduce(
    (counts, { testCase, result }) => {
      const expected = testCase.expectedEntityValue;
      const actual = new Set(
        result.entities
          .filter((entity) => entity.type === "workspace_object")
          .map((entity) => entity.value),
      );
      if (expected !== undefined && actual.has(expected)) {
        counts.truePositive++;
      } else if (expected !== undefined) {
        counts.falseNegative++;
      }
      counts.falsePositive += [...actual].filter((item) => item !== expected).length;
      return counts;
    },
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );
  const entityPrecision = entityCounts.truePositive + entityCounts.falsePositive === 0
    ? 0
    : entityCounts.truePositive /
      (entityCounts.truePositive + entityCounts.falsePositive);
  const entityRecall = entityCounts.truePositive + entityCounts.falseNegative === 0
    ? 0
    : entityCounts.truePositive /
      (entityCounts.truePositive + entityCounts.falseNegative);
  const entityF1 = entityPrecision + entityRecall === 0
    ? 0
    : 2 * entityPrecision * entityRecall / (entityPrecision + entityRecall);
  const contracts = predictions.map(({ testCase, result }) =>
    createIntelligenceContract(testCase.text, result),
  );
  const evaluated = predictions.map((item, index) => ({
    ...item,
    contract: contracts[index],
  }));
  const byKind = Object.fromEntries(
    [...new Set(dataset.cases.map((item) => item.kind))].map((kind) => {
      const subset = evaluated.filter((item) => item.testCase.kind === kind);
      return [kind, {
        count: subset.length,
        actionAccuracy: subset.filter(
          (item) => item.result.semantic.action === item.testCase.expectedAction,
        ).length / subset.length,
        clarificationRate: subset.filter((item) =>
          item.contract.clarification.required,
        ).length / subset.length,
        abstentionRate: subset.filter(
          (item) => item.result.semantic.action === "unknown",
        ).length / subset.length,
        ambiguityRecall: subset.filter(
          (item) => item.contract.ambiguity.detected,
        ).length / subset.length,
      }];
    }),
  );
  const ambiguousCases = evaluated.filter(
    ({ testCase }) => testCase.kind === "ambiguous",
  );
  const ambiguityRecall = ambiguousCases.filter(
    (item) => item.contract.ambiguity.detected,
  ).length / Math.max(1, ambiguousCases.length);
  const negativeAbstention = predictions.filter(
    ({ testCase }) => testCase.kind === "negated",
  ).every(({ result }) => result.semantic.action === "unknown");
  const clarificationCases = evaluated.filter(
    ({ testCase }) => testCase.kind === "ambiguous" || testCase.kind === "incomplete",
  );
  const clarificationRecall = clarificationCases.filter(
    (item) => item.contract.clarification.required,
  ).length / Math.max(1, clarificationCases.length);
  const sortedLatencies = predictions.map((item) => item.durationMs);
  const initializationCompleted = getEmbeddingModelStatus().state === "ready";
  const report = {
    benchmark: "FRIDAY NLU smoke evaluation",
    datasetVersion: dataset.datasetVersion,
    datasetSha256: createHash("sha256").update(bytes).digest("hex"),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    configuration: {
      cases: dataset.cases.length,
      transinfant: false,
      model: "Xenova/all-MiniLM-L6-v2",
      calibration: "not evaluated; confidence is an uncalibrated heuristic",
    },
    metrics: {
      intentAccuracy: intent.accuracy,
      intentMacroF1: intent.macroF1,
      intentByLabel: intent.byLabel,
      semanticActionAccuracy: action.accuracy,
      semanticActionMacroF1: action.macroF1,
      actionByLabel: action.byLabel,
      semanticObjectAccuracy: object.accuracy,
      exactIntentActionObject: `${fullyCorrect}/${predictions.length}`,
      entityExtraction: {
        evaluatedCases: predictions.length,
        precision: entityPrecision,
        recall: entityRecall,
        f1: entityF1,
      },
      ambiguityRecall,
      clarificationRecall,
      negatedActionAbstention: negativeAbstention,
      byKind,
      latencyMs: {
        coldFirstRequest: sortedLatencies[0] ?? 0,
        p50: quantile(sortedLatencies, 0.5),
        p95: quantile(sortedLatencies, 0.95),
      },
      initializationCompleted,
    },
    predictions: predictions.map(({ testCase, result, durationMs }) => ({
      id: testCase.id,
      expected: {
        intent: testCase.expectedIntent,
        action: testCase.expectedAction,
        object: testCase.expectedObject,
      },
      actual: {
        status: result.status,
        intent: result.intent.name,
        action: result.semantic.action,
        object: result.semantic.object,
      },
      durationMs,
    })),
  };
  const success =
    intent.accuracy >= 0.8 &&
    fullyCorrect / predictions.length >= 0.8 &&
    negativeAbstention &&
    ambiguityRecall === 1 &&
    clarificationRecall === 1 &&
    initializationCompleted;
  console.log(JSON.stringify({ ...report, thresholdsPassed: success }, null, 2));
  if (!success) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    level: "error",
    event: "friday_benchmark_failed",
    error: errorDetails(error),
  }));
  process.exitCode = 1;
});
