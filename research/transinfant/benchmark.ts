import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { understand } from "../../src/nlu/friday";
import { KnowledgeStore } from "../../src/transinfant/memory-store";
import { learnExperience } from "../../src/transinfant/learner";

const curriculum = {
  id: "benchmark-curriculum-v1",
  source: "published-synthetic-curriculum-v1",
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
    { subject: "summon", predicate: "equivalent-to", object: "open", source: "explicit" as const },
    { subject: "editor", predicate: "is-a", object: "application", source: "explicit" as const },
    { subject: "reveal", predicate: "equivalent-to", object: "show", source: "explicit" as const },
    { subject: "grid", predicate: "is-a", object: "spreadsheet", source: "explicit" as const },
  ],
};

const heldOut = [
  { text: "open editor", action: "open", object: "application" },
  { text: "show grid", action: "show", object: "spreadsheet" },
  { text: "summon editor", action: "open", object: "application" },
  { text: "reveal grid", action: "show", object: "spreadsheet" },
  { text: "reveal editor", action: "show", object: "application" },
  { text: "summon grid", action: "open", object: "spreadsheet" },
  { text: "open document", action: "open", object: "document" },
  { text: "show spreadsheet", action: "show", object: "spreadsheet" },
];
const REPETITIONS = 3;

function percentile(values: number[], percent: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((percent / 100) * sorted.length) - 1] ?? 0;
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "friday-transinfant-bench-"));
  try {
    const filePath = path.join(directory, "memory.json");
    const store = new KnowledgeStore(filePath);
    const learning = await learnExperience(curriculum, store);
    const baselineTimes: number[] = [];
    const integratedTimes: number[] = [];
    let baselineCorrect = 0;
    let integratedCorrect = 0;
    let actionCorrect = 0;
    let objectCorrect = 0;
    const coldStartStart = performance.now();
    await understand("open editor", "benchmark-cold-start", {
      transinfantEnabled: false,
    });
    const coldStartMs = performance.now() - coldStartStart;
    await understand("open editor", "benchmark-integrated-warmup", {
      transinfantEnabled: true,
      transinfantStore: store,
    });
    const rows = [];

    for (const [index, example] of heldOut.entries()) {
      let baseline = await understand(
        example.text,
        `benchmark-baseline-${index}-warmup`,
        { transinfantEnabled: false },
      );
      let integratedResult = await understand(
        example.text,
        `benchmark-integrated-${index}-warmup`,
        {
          transinfantEnabled: true,
          transinfantStore: store,
        },
      );

      for (let repetition = 0; repetition < REPETITIONS; repetition++) {
        const baselineStart = performance.now();
        baseline = await understand(
          example.text,
          `benchmark-baseline-${index}-${repetition}`,
          { transinfantEnabled: false },
        );
        baselineTimes.push(performance.now() - baselineStart);

        const integratedStart = performance.now();
        integratedResult = await understand(
          example.text,
          `benchmark-integrated-${index}-${repetition}`,
          {
            transinfantEnabled: true,
            transinfantStore: store,
          },
        );
        integratedTimes.push(performance.now() - integratedStart);
      }
      const baselineSemantic = baseline.semantic;
      const baselineIsCorrect =
        baselineSemantic.action === example.action &&
        baselineSemantic.object === example.object;
      if (baselineIsCorrect) baselineCorrect++;

      const transinfantDiagnostics =
        integratedResult.context.transinfant as {
          status: string;
          candidate: { evidence: string[] } | null;
        };
      const finalAction = integratedResult.semantic.action;
      const finalObject = integratedResult.semantic.object;
      const integratedIsCorrect =
        finalAction === example.action && finalObject === example.object;
      if (integratedIsCorrect) integratedCorrect++;
      if (finalAction === example.action) actionCorrect++;
      if (finalObject === example.object) objectCorrect++;

      rows.push({
        text: example.text,
        expected: { action: example.action, object: example.object },
        baseline: {
          action: baselineSemantic.action,
          object: baselineSemantic.object,
        },
        integrated: {
          action: finalAction,
          object: finalObject,
          status: transinfantDiagnostics.status,
          evidence: transinfantDiagnostics.candidate?.evidence ?? [],
        },
      });
    }

    const data = await readFile(filePath);
    const output = {
      benchmark: "transinfant-heldout-composition-v1",
      runtime: process.version,
      seed: "not-applicable; deterministic hand-authored curriculum",
      curriculum: {
        entityCount: curriculum.entities.length,
        acceptedRelationships: learning.acceptedRelationshipIds.length,
        heldOutCount: heldOut.length,
        generatedExamples: false,
      },
      metrics: {
        baselineExactFrameAccuracy: baselineCorrect / heldOut.length,
        integratedExactFrameAccuracy: integratedCorrect / heldOut.length,
        integratedActionAccuracy: actionCorrect / heldOut.length,
        integratedObjectAccuracy: objectCorrect / heldOut.length,
        sampleCount: heldOut.length,
        confidenceIntervals: "not reported; small deterministic demonstration set",
        baselineLatencyMs: {
          p50: Number(percentile(baselineTimes, 50).toFixed(3)),
          p95: Number(percentile(baselineTimes, 95).toFixed(3)),
        },
        integratedLatencyMs: {
          p50: Number(percentile(integratedTimes, 50).toFixed(3)),
          p95: Number(percentile(integratedTimes, 95).toFixed(3)),
        },
        warmTimingRepetitionsPerSample: REPETITIONS,
        coldFirstRequestMs: Number(coldStartMs.toFixed(3)),
        persistedMemoryBytes: (await stat(filePath)).size,
        actualReadBytes: data.byteLength,
      },
      rows,
    };
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error("TransInfant benchmark failed:", error);
  process.exitCode = 1;
});
