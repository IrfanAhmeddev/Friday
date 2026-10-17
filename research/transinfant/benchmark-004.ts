import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzeUnlabeledPatternAmbiguity,
  GrammarPatternStore,
  induceGrammarPattern,
  interpretWithGrammarPattern,
  supplyGrammarPattern,
  type LabeledPatternExample,
  type PatternFrame,
} from "../../src/transinfant/grammar-pattern";
import { KnowledgeStore } from "../../src/transinfant/memory-store";

interface EvaluationItem {
  id: string;
  category: string;
  text: string;
  expected: PatternFrame | null;
}

interface Dataset<T> {
  datasetVersion: string;
  examples?: T[];
  probes?: T[];
}

const root = path.resolve(__dirname);
const artifactDirectory = path.join(root);
const trainingPath = path.join(root, "datasets", "experiment-004-training.json");
const developmentPath = path.join(root, "datasets", "experiment-004-development.json");
const validationPath = path.join(root, "datasets", "experiment-004-validation.json");
const testPath = path.join(root, "datasets", "experiment-004-test.json");
const adversarialPath = path.join(root, "datasets", "experiment-004-adversarial.json");

function frameEqual(actual: PatternFrame | null, expected: PatternFrame | null): boolean {
  if (actual === null || expected === null) return actual === expected;
  return actual.subject.toLowerCase() === expected.subject.toLowerCase() &&
    actual.predicate.toLowerCase() === expected.predicate.toLowerCase() &&
    actual.object.toLowerCase() === expected.object.toLowerCase();
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

async function load<T>(file: string): Promise<{ bytes: Buffer; data: Dataset<T> }> {
  const bytes = await readFile(file);
  return { bytes, data: JSON.parse(bytes.toString("utf8")) as Dataset<T> };
}

async function main(): Promise<void> {
  const [training, development, validation, test, adversarialDataset] = await Promise.all([
    load<LabeledPatternExample>(trainingPath),
    load<EvaluationItem>(developmentPath),
    load<EvaluationItem>(validationPath),
    load<EvaluationItem>(testPath),
    load<Record<string, unknown>>(adversarialPath),
  ]);
  const examples = training.data.examples ?? [];
  const evalSets = {
    development: development.data.examples ?? [],
    validation: validation.data.examples ?? [],
    test: test.data.examples ?? [],
  };
  const knownTokens = [...new Set(examples.flatMap((example) => example.tokens.map((token) => token.toLowerCase())))];
  const directory = await mkdtemp(path.join(os.tmpdir(), "tida-004-"));
  try {
    const inducedStore = new GrammarPatternStore(path.join(directory, "induced.json"));
    const suppliedStore = new GrammarPatternStore(path.join(directory, "supplied.json"));
    const induced = induceGrammarPattern(examples);
    const supplied = supplyGrammarPattern("supplied-svo-v1", ["subject", "predicate", "object"]);
    await Promise.all([inducedStore.write(induced), suppliedStore.write(supplied)]);
    await writeFile(
      path.join(artifactDirectory, "pattern-snapshot-004.json"),
      `${JSON.stringify(induced, null, 2)}\n`,
      "utf8",
    );

    const conditionPrediction = async (
      condition: "A" | "B" | "C" | "D",
      item: EvaluationItem,
    ): Promise<{ frame: PatternFrame | null; status: string; reason: string | null }> => {
      if (condition === "A") {
        return { frame: null, status: "abstain", reason: "No pattern or examples supplied." };
      }
      if (condition === "B") {
        const matched = examples.find(
          (example) => example.tokens.map((token) => token.toLowerCase()).join(" ") ===
            item.text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" "),
        );
        return matched
          ? { frame: matched.frame, status: "retrieved", reason: null }
          : { frame: null, status: "abstain", reason: "No exact teaching example." };
      }
      const result = await interpretWithGrammarPattern(
        item.text,
        condition === "C" ? inducedStore : suppliedStore,
        {},
        knownTokens,
      );
      return { frame: result.frame, status: result.status, reason: result.reason };
    };

    const outcomes: Record<string, unknown> = {};
    for (const condition of ["A", "B", "C", "D"] as const) {
      const splitResults: Record<string, unknown> = {};
      for (const [split, items] of Object.entries(evalSets)) {
        const predictions = [];
        for (const item of items) {
          const prediction = await conditionPrediction(condition, item);
          predictions.push({
            id: item.id,
            category: item.category,
            expected: item.expected,
            actual: prediction.frame,
            status: prediction.status,
            reason: prediction.reason,
            exact: frameEqual(prediction.frame, item.expected),
          });
        }
        const correct = predictions.filter((prediction) => prediction.exact).length;
        const grouped = new Map<string, { correct: number; count: number }>();
        const confusion = new Map<string, Map<string, number>>();
        const roleAccuracy = {
          subject: { correct: 0, total: 0 },
          predicate: { correct: 0, total: 0 },
          object: { correct: 0, total: 0 },
        };
        for (const prediction of predictions) {
          const current = grouped.get(prediction.category) ?? { correct: 0, count: 0 };
          current.count++;
          if (prediction.exact) current.correct++;
          grouped.set(prediction.category, current);
          const categoryConfusion = confusion.get(prediction.category) ?? new Map<string, number>();
          const expectedKey = prediction.expected
            ? JSON.stringify(prediction.expected)
            : "abstain";
          const actualKey = prediction.actual
            ? JSON.stringify(prediction.actual)
            : "abstain";
          const confusionKey = `${expectedKey} => ${actualKey}`;
          categoryConfusion.set(confusionKey, (categoryConfusion.get(confusionKey) ?? 0) + 1);
          confusion.set(prediction.category, categoryConfusion);
          if (prediction.expected) {
            for (const role of ["subject", "predicate", "object"] as const) {
              roleAccuracy[role].total++;
              if (
                prediction.actual &&
                prediction.actual[role].toLowerCase() === prediction.expected[role].toLowerCase()
              ) {
                roleAccuracy[role].correct++;
              }
            }
          }
        }
        splitResults[split] = {
          exact: correct,
          total: predictions.length,
          accuracy: predictions.length === 0 ? null : correct / predictions.length,
          perCategory: Object.fromEntries(
            [...grouped].map(([category, counts]) => [
              category,
              {
                ...counts,
                confusionCounts: Object.fromEntries(confusion.get(category) ?? []),
              },
            ]),
          ),
          roleAccuracy,
          predictions,
        };
      }
      const timedItems = evalSets.test;
      const timings: number[] = [];
      for (const item of timedItems) {
        for (let repetition = 0; repetition < 5; repetition++) {
          const start = performance.now();
          await conditionPrediction(condition, item);
          timings.push(performance.now() - start);
        }
      }
      const unsupported = evalSets.test.filter((item) => item.expected === null);
      const unsupportedPredictions = await Promise.all(
        unsupported.map((item) => conditionPrediction(condition, item)),
      );
      const supportedItems = evalSets.test.filter((item) => item.expected !== null);
      const supportedPredictions = await Promise.all(
        supportedItems.map((item) => conditionPrediction(condition, item)),
      );
      const patternPath = condition === "C"
        ? inducedStore.getFilePath()
        : condition === "D"
          ? suppliedStore.getFilePath()
          : null;
      outcomes[condition] = {
        description: {
          A: "Empty memory.",
          B: "Exact example retrieval only.",
          C: "Weakly supervised induction from the same labeled examples.",
          D: "Directly supplied SVO rule; reference, not learned.",
        }[condition],
        pattern: condition === "C" ? induced : condition === "D" ? supplied : null,
        splits: splitResults,
        unsupportedAcceptance: {
          count: unsupportedPredictions.filter((result) => result.frame !== null).length,
          total: unsupported.length,
        },
        correctAbstention: {
          count: unsupportedPredictions.filter((result) => result.frame === null).length,
          total: unsupported.length,
        },
        heldOutComposition: {
          correct: supportedPredictions.filter((result, index) =>
            frameEqual(result.frame, supportedItems[index].expected),
          ).length,
          total: supportedItems.length,
        },
        patternMemoryBytes: patternPath ? (await stat(patternPath)).size : 0,
        exampleMemoryBytes: condition === "B" ? training.bytes.byteLength : 0,
        latencyMs: {
          observations: timings.length,
          p50: percentile(timings, 0.5),
          p95: percentile(timings, 0.95),
        },
      };
    }

    const adversarialProbes = adversarialDataset.data.probes ?? [];
    const contradictionExamples: LabeledPatternExample[] = [
      ...examples.slice(0, 2),
      {
        id: "contradictory-evidence",
        tokens: ["Sena", "dax", "lumo"],
        frame: { subject: "lumo", predicate: "dax", object: "Sena" },
      },
    ];
    const oneExample = induceGrammarPattern(examples.slice(0, 1));
    const contradiction = induceGrammarPattern(contradictionExamples);
    const duplicate = induceGrammarPattern([
      examples[0],
      { ...examples[0], id: "duplicate-2" },
      { ...examples[0], id: "duplicate-3" },
    ]);
    const unlabeledCandidates = analyzeUnlabeledPatternAmbiguity(
      examples.map((example) => example.tokens),
    );
    const restartStore = new GrammarPatternStore(path.join(directory, "restart.json"));
    await restartStore.write(induced);
    const beforeReset = await interpretWithGrammarPattern("Tavi vek lumo", restartStore, {}, knownTokens);
    const restartedOutput = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(root, "restart-probe-004.ts"),
        restartStore.getFilePath(),
        "Tavi vek lumo",
        JSON.stringify(knownTokens),
      ],
      { cwd: path.resolve(root, "..", ".."), encoding: "utf8" },
    );
    const restarted = JSON.parse(restartedOutput) as {
      status: string;
      patternVersion: number | null;
      provenance: string[];
      frame: PatternFrame | null;
    };
    await restartStore.reset();
    const afterReset = await interpretWithGrammarPattern("Tavi vek lumo", restartStore, {}, knownTokens);
    const corruptPath = path.join(directory, "corrupt.json");
    await writeFile(corruptPath, "{broken", "utf8");
    let corruptReadRejected = false;
    try {
      await new GrammarPatternStore(corruptPath).read();
    } catch (error) {
      corruptReadRejected =
        error instanceof Error && /Could not parse grammar-pattern store/.test(error.message);
    }
    const corruptMemoryPreserved = (await readFile(corruptPath, "utf8")) === "{broken";
    let productionPathGuardPassed = false;
    try {
      new GrammarPatternStore(new KnowledgeStore().getFilePath());
    } catch (error) {
      productionPathGuardPassed =
        error instanceof Error && /cannot use FRIDAY's production memory path/.test(error.message);
    }
    const adversarial = {
      datasetProbeCount: adversarialProbes.length,
      unlabeled: {
        candidateCount: unlabeledCandidates.length,
        distinctScores: [...new Set(unlabeledCandidates.map((candidate) => candidate.score))],
        status: "ambiguous",
        expectedStatus: "ambiguous",
        pass: unlabeledCandidates.length === 6 && new Set(unlabeledCandidates.map((candidate) => candidate.score)).size === 1,
      },
      insufficientEvidence: {
        status: oneExample.status,
        pass: oneExample.status === "ambiguous",
      },
      contradiction: {
        status: contradiction.status,
        acceptedPattern: contradiction.pattern,
        pass: contradiction.status === "rejected" && contradiction.pattern === null,
      },
      duplicateEvidence: {
        status: duplicate.status,
        distinctEvidenceCount: duplicate.evidenceIds.length,
        confidence: duplicate.confidence,
        pass: duplicate.status === "ambiguous" && duplicate.evidenceIds.length === 1,
      },
      restart: {
        separateProcess: true,
        sameVersion: restarted.patternVersion === induced.version,
        sameEvidence: JSON.stringify(restarted.provenance) === JSON.stringify(induced.evidenceIds),
        outcomeBeforeReset: beforeReset.status,
        outcomeAfterReset: afterReset.status,
        resultAfterReload: restarted.status,
        pass: restarted.patternVersion === induced.version &&
          JSON.stringify(restarted.provenance) === JSON.stringify(induced.evidenceIds) &&
          frameEqual(restarted.frame, beforeReset.frame) &&
          beforeReset.status === "supported" && afterReset.status === "ambiguous",
      },
      corruptStore: {
        readRejected: corruptReadRejected,
        contentPreserved: corruptMemoryPreserved,
        pass: corruptReadRejected && corruptMemoryPreserved,
      },
      productionPathGuard: {
        pass: productionPathGuardPassed,
      },
      allPassed: false,
    };
    adversarial.allPassed = adversarial.unlabeled.pass &&
      adversarial.insufficientEvidence.pass &&
      adversarial.contradiction.pass &&
      adversarial.duplicateEvidence.pass &&
      adversarial.restart.pass &&
      adversarial.corruptStore.pass &&
      adversarial.productionPathGuard.pass;

    const hashes = Object.fromEntries(
      await Promise.all(
        [
          ["training", trainingPath, training.bytes],
          ["development", developmentPath, development.bytes],
          ["validation", validationPath, validation.bytes],
          ["test", testPath, test.bytes],
          ["adversarial", adversarialPath, adversarialDataset.bytes],
        ].map(async ([name, file, bytes]) => [
          name,
          {
            path: path.relative(root, file as string),
            sha256: createHash("sha256").update(bytes as Buffer).digest("hex"),
          },
        ]),
      ),
    );
    const result = {
      experiment: "TIDA-004",
      datasetVersion: training.data.datasetVersion,
      capturedAt: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      codeRevision: null,
      codeRevisionNote: "Unavailable: the workspace is not inside a Git repository.",
      configuration: {
        candidateBound: 6,
        evidenceBound: 64,
        repeatsPerTestExample: 5,
        trainingExamples: examples.length,
        developmentExamples: evalSets.development.length,
        validationExamples: evalSets.validation.length,
        heldOutExamples: evalSets.test.length,
        knownVocabulary: knownTokens,
        evidenceExampleLimit: 64,
        trainingExampleFixtureBytes: training.bytes.byteLength,
      },
      datasetHashes: hashes,
      conditions: outcomes,
      adversarial,
      execution: {
        evaluationFailures: 0,
        timedOutOperations: 0,
        perOperationTimeoutConfigured: false,
      },
    };
    await writeFile(
      path.join(artifactDirectory, "results-004.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(result, null, 2));
    if (!adversarial.allPassed) process.exitCode = 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
