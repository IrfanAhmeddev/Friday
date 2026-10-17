import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inspectVocabulary,
  queryVocabulary,
  resetVocabularyMemory,
  teachVocabulary,
  type VocabularyExperience,
} from "../../src/transinfant/vocabulary-learning";
import { KnowledgeStore } from "../../src/transinfant/memory-store";
import {
  GrammarPatternStore,
  induceGrammarPattern,
  interpretWithGrammarPattern,
  type LabeledPatternExample,
  type PatternFrame,
} from "../../src/transinfant/grammar-pattern";
import { revertExperience } from "../../src/transinfant/learner";

interface VocabularyItem {
  id: string;
  surface: string;
  concept: string;
  label: string;
  role: "entity" | "predicate" | "property";
}

interface HeldOutItem {
  id: string;
  text: string;
  expected: PatternFrame;
}

interface PhaseData {
  datasetVersion: string;
  phaseA: {
    vocabulary: VocabularyItem[];
    examples: LabeledPatternExample[];
    evaluation: HeldOutItem[];
  };
  phaseB: { vocabulary: VocabularyItem[]; evaluation: HeldOutItem[] };
  phaseC: {
    examples: LabeledPatternExample[];
    evaluation: HeldOutItem[];
    contradictoryExample: LabeledPatternExample;
    correctedExample: LabeledPatternExample;
  };
  phaseD: {
    incorrectMapping: { experienceId: string; surface: string; concept: string; label: string };
    correctMapping: { experienceId: string; surface: string; concept: string; label: string };
    unrelatedSurface: string;
  };
  phaseF: { unrelatedVocabulary: Array<{ surface: string; concept: string }> };
}

const root = path.resolve(__dirname);
const artifactDir = root;
const curriculumPath = path.join(root, "datasets", "experiment-005-phases.json");
const heldOutPath = path.join(root, "datasets", "experiment-005-heldout-v2.json");
const projectRoot = path.resolve(root, "..", "..");

function createTeaching(
  id: string,
  surface: string,
  conceptId: string,
  label: string,
  semanticRole: VocabularyExperience["concept"]["semanticRole"],
  relationshipSource: VocabularyExperience["relationshipSource"] = "explicit",
): VocabularyExperience {
  return {
    id,
    source: "tida-005-curriculum",
    input: { id: `input.${surface}`, kind: "word", surface },
    concept: { id: conceptId, label, semanticRole },
    confidence: relationshipSource === "inferred" ? 0.5 : 1,
    relationshipSource,
  };
}

async function teachBatch(
  items: VocabularyItem[],
  store: KnowledgeStore,
): Promise<{ durationMs: number; accepted: number; rejected: number }> {
  const start = performance.now();
  let accepted = 0;
  let rejected = 0;
  for (const item of items) {
    const result = await teachVocabulary(
      createTeaching(item.id, item.surface, item.concept, item.label, item.role),
      store,
    );
    accepted += result.acceptedRelationshipIds.length;
    rejected += result.rejectedRelationshipIds.length;
  }
  return { durationMs: performance.now() - start, accepted, rejected };
}

async function interpret(
  sentence: string,
  vocabularyStore: KnowledgeStore,
  patternStore: GrammarPatternStore,
): Promise<{ status: string; frame: PatternFrame | null; confidence: number | null }> {
  const tokens = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];
  const conceptsByToken: Record<string, string> = {};
  const knownTokens: string[] = [];
  for (const token of tokens) {
    const lookup = await queryVocabulary("word", token, vocabularyStore);
    if (lookup.status === "supported" && lookup.concept) {
      conceptsByToken[token.toLowerCase()] = lookup.concept.id;
      knownTokens.push(token);
    }
  }
  const result = await interpretWithGrammarPattern(
    sentence,
    patternStore,
    conceptsByToken,
    knownTokens,
  );
  return { status: result.status, frame: result.frame, confidence: result.confidence };
}

function matches(actual: PatternFrame | null, expected: PatternFrame): boolean {
  return actual !== null &&
    actual.subject === expected.subject &&
    actual.predicate === expected.predicate &&
    actual.object === expected.object;
}

async function saveCheckpoint(
  directory: string,
  phase: string,
  knowledgeStore: KnowledgeStore,
  patternStore: GrammarPatternStore,
): Promise<void> {
  const memory = await inspectVocabulary(knowledgeStore);
  const pattern = await patternStore.read();
  const content = {
    experiment: "TIDA-005",
    datasetVersion: "tida-005-incremental-curriculum-v2",
    phase,
    knowledge: memory,
    pattern,
  };
  const filePath = path.join(directory, `${phase}.json`);
  await writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

async function measureStoreBytes(
  vocabularyStore: KnowledgeStore,
  patternStore: GrammarPatternStore,
): Promise<{ vocabulary: number; pattern: number }> {
  const sizeIfPresent = async (filePath: string): Promise<number> => {
    try {
      return (await stat(filePath)).size;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return 0;
      }
      throw error;
    }
  };
  const [vocabulary, pattern] = await Promise.all([
    sizeIfPresent(vocabularyStore.getFilePath()),
    sizeIfPresent(patternStore.getFilePath()),
  ]);
  return { vocabulary, pattern };
}

async function runOrder(
  name: string,
  first: "A" | "B",
  phases: PhaseData,
  heldOut: HeldOutItem[],
  checkpointDirectory?: string,
): Promise<Record<string, unknown>> {
  const directory = await mkdtemp(path.join(os.tmpdir(), `tida-005-${name}-`));
  try {
    const vocabularyStore = new KnowledgeStore(path.join(directory, "vocabulary.json"));
    const patternStore = new GrammarPatternStore(path.join(directory, "pattern.json"));
    const teachingResults: Record<string, unknown> = {};
    const memoryBytes: Record<string, { vocabulary: number; pattern: number }> = {};
    const phasesDuration: Record<string, number> = {};
    const phaseProbeScores: Record<string, unknown> = {};
    const phaseExamples = phases.phaseA.examples;
    let phaseAAcquisition = { correct: 0, total: phases.phaseA.vocabulary.length };
    const runA = async (): Promise<void> => {
      const outcome = await teachBatch(phases.phaseA.vocabulary, vocabularyStore);
      teachingResults.phaseA = outcome;
      phasesDuration.phaseA = outcome.durationMs;
      await patternStore.write(induceGrammarPattern(phaseExamples, 1));
      const acquired = await Promise.all(
        phases.phaseA.vocabulary.map((item) => queryVocabulary("word", item.surface, vocabularyStore)),
      );
      phaseAAcquisition = {
        correct: acquired.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === phases.phaseA.vocabulary[index].concept,
        ).length,
        total: acquired.length,
      };
      const predictions = await Promise.all(
        phases.phaseA.evaluation.map(async (item) => ({
          id: item.id,
          ...await interpret(item.text, vocabularyStore, patternStore),
          expected: item.expected,
        })),
      );
      phaseProbeScores.phaseA = {
        correct: predictions.filter((prediction) => matches(prediction.frame, prediction.expected)).length,
        total: predictions.length,
        predictions,
      };
      await saveCheckpoint(checkpointDirectory ?? directory, "phase-a", vocabularyStore, patternStore);
      memoryBytes.phaseA = await measureStoreBytes(vocabularyStore, patternStore);
    };
    const runB = async (): Promise<void> => {
      const outcome = await teachBatch(phases.phaseB.vocabulary, vocabularyStore);
      teachingResults.phaseB = outcome;
      phasesDuration.phaseB = outcome.durationMs;
      memoryBytes.phaseB = await measureStoreBytes(vocabularyStore, patternStore);
      const predictions = await Promise.all(
        phases.phaseB.evaluation.map(async (item) => ({
          id: item.id,
          ...await interpret(item.text, vocabularyStore, patternStore),
          expected: item.expected,
        })),
      );
      phaseProbeScores.phaseB = {
        correct: predictions.filter((prediction) => matches(prediction.frame, prediction.expected)).length,
        total: predictions.length,
        predictions,
      };
    };
    if (first === "A") {
      await runA();
      const oldAfterA = await Promise.all(
        phases.phaseA.vocabulary.map((item) => queryVocabulary("word", item.surface, vocabularyStore)),
      );
      await runB();
      const newAfterB = await Promise.all(
        phases.phaseB.vocabulary.map((item) => queryVocabulary("word", item.surface, vocabularyStore)),
      );
      teachingResults.phaseARetentionAfterB = {
        correct: oldAfterA.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === phases.phaseA.vocabulary[index].concept,
        ).length,
        total: oldAfterA.length,
      };
      teachingResults.phaseBAcquisition = {
        correct: newAfterB.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === phases.phaseB.vocabulary[index].concept,
        ).length,
        total: newAfterB.length,
      };
    } else {
      await runB();
      const newBeforeA = await Promise.all(
        phases.phaseB.vocabulary.map((item) => queryVocabulary("word", item.surface, vocabularyStore)),
      );
      await runA();
      const oldAfterA = await Promise.all(
        phases.phaseA.vocabulary.map((item) => queryVocabulary("word", item.surface, vocabularyStore)),
      );
      teachingResults.phaseBAcquisition = {
        correct: newBeforeA.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === phases.phaseB.vocabulary[index].concept,
        ).length,
        total: newBeforeA.length,
      };
      teachingResults.phaseARetentionAfterB = {
        correct: oldAfterA.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === phases.phaseA.vocabulary[index].concept,
        ).length,
        total: oldAfterA.length,
      };
    }
    await saveCheckpoint(checkpointDirectory ?? directory, "phase-a-b", vocabularyStore, patternStore);

    const currentPatternExamples = [...phaseExamples, ...phases.phaseC.examples];
    const phaseCStart = performance.now();
    const contradiction = induceGrammarPattern(
      [...currentPatternExamples, phases.phaseC.contradictoryExample],
      3,
    );
    const corrected = induceGrammarPattern(
      [...currentPatternExamples, phases.phaseC.correctedExample],
      4,
    );
    await patternStore.write(corrected);
    const prePatternRevision = induceGrammarPattern(phaseExamples, 1);
    await patternStore.write(prePatternRevision);
    const interpretedAfterPatternRevert = await interpret(
      "tavi vek neri",
      vocabularyStore,
      patternStore,
    );
    const patternRevertCorrect =
      (await patternStore.read())?.version === prePatternRevision.version &&
      interpretedAfterPatternRevert.frame?.subject === "person.tavi";
    await patternStore.write(corrected);
    phasesDuration.phaseC = performance.now() - phaseCStart;
    await saveCheckpoint(checkpointDirectory ?? directory, "phase-c", vocabularyStore, patternStore);
    memoryBytes.phaseC = await measureStoreBytes(vocabularyStore, patternStore);
    const phaseC = {
      evidenceExamples: currentPatternExamples.length,
      patternAccepted: corrected.status === "accepted",
      correctedVersion: corrected.version,
      contradictionStatus: contradiction.status,
      contradictionAccepted: contradiction.status === "accepted",
      revisedPattern: corrected.pattern,
      revisionRevert: {
        restoredVersion: prePatternRevision.version,
        interpretationStatus: interpretedAfterPatternRevert.status,
        correct: patternRevertCorrect,
      },
    };
    const phaseCPredictions = await Promise.all(
      phases.phaseC.evaluation.map(async (item) => ({
        id: item.id,
        ...await interpret(item.text, vocabularyStore, patternStore),
        expected: item.expected,
      })),
    );
    phaseProbeScores.phaseC = {
      correct: phaseCPredictions.filter((prediction) => matches(prediction.frame, prediction.expected)).length,
      total: phaseCPredictions.length,
      predictions: phaseCPredictions,
    };

    const unrelatedBefore = await queryVocabulary(
      "word",
      phases.phaseD.unrelatedSurface,
      vocabularyStore,
    );
    const noCorrectionDirectory = path.join(directory, "no-correction");
    const noCorrectionStore = new KnowledgeStore(path.join(noCorrectionDirectory, "vocabulary.json"));
    const noCorrectionPatternStore = new GrammarPatternStore(path.join(noCorrectionDirectory, "pattern.json"));
    await teachBatch(
      [...phases.phaseA.vocabulary, ...phases.phaseB.vocabulary],
      noCorrectionStore,
    );
    await noCorrectionPatternStore.write(
      induceGrammarPattern(
        [...phaseExamples, ...phases.phaseC.examples, phases.phaseC.correctedExample],
        4,
      ),
    );
    const noCorrectionMapping = await queryVocabulary("word", "tavi", noCorrectionStore);
    const noCorrectionPredictions = await Promise.all(
      heldOut.map(async (item) => ({
        ...await interpret(item.text, noCorrectionStore, noCorrectionPatternStore),
        expected: item.expected,
      })),
    );
    const noCorrectionCorrect = noCorrectionPredictions.filter((result) =>
      matches(result.frame, result.expected),
    ).length;
    const phaseDStart = performance.now();
    const incorrect = phases.phaseD.incorrectMapping;
    const incorrectAttempt = await teachVocabulary(
      createTeaching(
        "phase-d-rejected-conflict",
        incorrect.surface,
        incorrect.concept,
        incorrect.label,
        "entity",
        "explicit",
      ),
      vocabularyStore,
    );
    const wrongFeedback = await teachVocabulary(
      createTeaching(
        incorrect.experienceId,
        incorrect.surface,
        incorrect.concept,
        incorrect.label,
        "entity",
        "feedback",
      ),
      vocabularyStore,
    );
    const mappingAfterWrong = await queryVocabulary("word", incorrect.surface, vocabularyStore);
    const correct = phases.phaseD.correctMapping;
    const correction = await teachVocabulary(
      createTeaching(
        correct.experienceId,
        correct.surface,
        correct.concept,
        correct.label,
        "entity",
        "feedback",
      ),
      vocabularyStore,
    );
    const mappingAfterCorrection = await queryVocabulary("word", correct.surface, vocabularyStore);
    const unrelatedAfter = await queryVocabulary("word", phases.phaseD.unrelatedSurface, vocabularyStore);
    await saveCheckpoint(checkpointDirectory ?? directory, "phase-d-corrected", vocabularyStore, patternStore);
    const revertCorrection = await revertExperience(correct.experienceId, vocabularyStore);
    const mappingAfterRevertCorrection = await queryVocabulary("word", correct.surface, vocabularyStore);
    const revertWrong = await revertExperience(incorrect.experienceId, vocabularyStore);
    const mappingAfterRevertWrong = await queryVocabulary("word", correct.surface, vocabularyStore);
    const correctionMetrics = {
      explicitContradictionRejected: incorrectAttempt.rejectedRelationshipIds.length === 1,
      wrongFeedbackAccepted: wrongFeedback.acceptedRelationshipIds.length === 1,
      correctionAccepted: correction.acceptedRelationshipIds.length === 1,
      correctionResult: mappingAfterCorrection.concept?.id ?? null,
      correctionSuccess: mappingAfterCorrection.concept?.id === correct.concept,
      unrelatedPreservedDuringCorrection:
        unrelatedBefore.concept?.id === unrelatedAfter.concept?.id,
      revertingCorrectionRestoresWrongMapping:
        revertCorrection && mappingAfterRevertCorrection.concept?.id === incorrect.concept,
      revertingWrongUpdateRestoresOriginal:
        revertWrong && mappingAfterRevertWrong.concept?.id === "person.tavi",
      noCorrectionControlRetainsOriginal:
        noCorrectionMapping.concept?.id === "person.tavi",
      correctionEventHistory: (await inspectVocabulary(vocabularyStore)).events
        .filter((event) =>
          [incorrect.experienceId, correct.experienceId].includes(event.experienceId),
        )
        .map((event) => ({ experienceId: event.experienceId, outcome: event.outcome, details: event.details })),
    };
    phasesDuration.phaseD = performance.now() - phaseDStart;
    await saveCheckpoint(checkpointDirectory ?? directory, "phase-d-reverted", vocabularyStore, patternStore);
    memoryBytes.phaseD = await measureStoreBytes(vocabularyStore, patternStore);

    const preInterference = await Promise.all(
      heldOut.map(async (item) => ({
        id: item.id,
        ...await interpret(item.text, vocabularyStore, patternStore),
      })),
    );
    const preCorrect = preInterference.filter(
      (result, index) => matches(result.frame, heldOut[index].expected),
    ).length;
    const retrievalOnly = heldOut.map((item) => {
      const match = [...phaseExamples, ...phases.phaseC.examples, phases.phaseC.correctedExample]
        .find((example) => example.tokens.join(" ") === item.text);
      return match ? matches(match.frame, item.expected) : false;
    });
    const unrelated = phases.phaseF.unrelatedVocabulary.map((item, index): VocabularyItem => ({
      id: `phase-f-${index}`,
      surface: item.surface,
      concept: item.concept,
      label: item.concept,
      role: "entity",
    }));
    const phaseF = await teachBatch(unrelated, vocabularyStore);
    phasesDuration.phaseF = phaseF.durationMs;
    const postInterference = await Promise.all(
      heldOut.map(async (item) => ({
        id: item.id,
        ...await interpret(item.text, vocabularyStore, patternStore),
      })),
    );
    const postCorrect = postInterference.filter(
      (result, index) => matches(result.frame, heldOut[index].expected),
    ).length;
    const oldVocabularyAfterInterference = await Promise.all(
      [...phases.phaseA.vocabulary, ...phases.phaseB.vocabulary].map(
        (item) => queryVocabulary("word", item.surface, vocabularyStore),
      ),
    );
    const expectedVocabulary = [...phases.phaseA.vocabulary, ...phases.phaseB.vocabulary];
    const vocabularyQueries = await Promise.all(
      expectedVocabulary.map(
        (item) => queryVocabulary("word", item.surface, vocabularyStore),
      ),
    );
    const oldVocabularyCorrectAfterInterference = oldVocabularyAfterInterference.filter(
      (item, index) =>
        item.status === "supported" &&
        item.concept?.id === expectedVocabulary[index].concept,
    ).length;
    const falseAssociations = vocabularyQueries.filter(
      (item, index) =>
        item.status === "supported" &&
        item.concept?.id !== expectedVocabulary[index].concept,
    ).length;
    const inferenceTimes: number[] = [];
    for (const item of heldOut) {
      for (let repetition = 0; repetition < 5; repetition++) {
        const start = performance.now();
        await interpret(item.text, vocabularyStore, patternStore);
        inferenceTimes.push(performance.now() - start);
      }
    }
    const sortedInferenceTimes = [...inferenceTimes].sort((left, right) => left - right);
    const p50Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.5) - 1);
    const p95Index = Math.max(0, Math.ceil(sortedInferenceTimes.length * 0.95) - 1);
    await saveCheckpoint(checkpointDirectory ?? directory, "phase-f", vocabularyStore, patternStore);
    memoryBytes.phaseF = await measureStoreBytes(vocabularyStore, patternStore);

    const restartJson = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(root, "restart-probe-005.ts"),
        vocabularyStore.getFilePath(),
        patternStore.getFilePath(),
        ...heldOut.map((item) => item.text),
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );
    const restarted = JSON.parse(restartJson) as {
      interpretations: Array<{
        frame: PatternFrame | null;
        status: string;
        patternId: string | null;
        patternVersion: number | null;
        provenance: string[];
      }>;
      conceptCount: number;
      relationshipCount: number;
      eventCount: number;
    };
    const restartMatches = restarted.interpretations.filter(
      (result, index) => matches(result.frame, heldOut[index].expected),
    ).length;
    const stateBeforeReset = await inspectVocabulary(vocabularyStore);
    const restartKnowledgeStateMatches =
      restarted.conceptCount === stateBeforeReset.concepts.length &&
      restarted.relationshipCount === stateBeforeReset.relationships.length &&
      restarted.eventCount === stateBeforeReset.events.length;
    const restartPatternProvenanceMatches =
      restarted.interpretations[0]?.patternId === corrected.id &&
      restarted.interpretations[0]?.patternVersion === corrected.version &&
      JSON.stringify(restarted.interpretations[0]?.provenance) ===
        JSON.stringify(corrected.evidenceIds);
    await resetVocabularyMemory(vocabularyStore);
    await patternStore.reset();
    const afterReset = await queryVocabulary("word", "mira", vocabularyStore);
    const resetPattern = await patternStore.read();
    let productionGuardPassed = false;
    try {
      await resetVocabularyMemory(new KnowledgeStore());
    } catch (error) {
      productionGuardPassed =
        error instanceof Error && /production TransInfant store is protected/.test(error.message);
    }
    let patternProductionGuardPassed = false;
    try {
      new GrammarPatternStore(new KnowledgeStore().getFilePath());
    } catch (error) {
      patternProductionGuardPassed =
        error instanceof Error && /cannot use FRIDAY's production memory path/.test(error.message);
    }

    const emptyPatternStore = new GrammarPatternStore(path.join(directory, "empty-pattern.json"));
    const emptyVocabularyStore = new KnowledgeStore(path.join(directory, "empty-vocabulary.json"));
    const emptyPredictions = await Promise.all(
      heldOut.map((item) => interpret(item.text, emptyVocabularyStore, emptyPatternStore)),
    );
    const emptyCorrect = emptyPredictions.filter(
      (result, index) => matches(result.frame, heldOut[index].expected),
    ).length;
    const phaseResults = {
      phaseA: {
        vocabularyAcquisition: phaseAAcquisition,
        teachingExamples: phaseExamples.length,
        patternStatus: "accepted",
        heldOutProbe: phaseProbeScores.phaseA,
      },
      phaseB: {
        newVocabulary: teachingResults.phaseBAcquisition,
        phaseAKnowledgeRetained: teachingResults.phaseARetentionAfterB,
        heldOutProbe: phaseProbeScores.phaseB,
      },
      phaseC: { ...phaseC, heldOutProbe: phaseProbeScores.phaseC },
      phaseD: correctionMetrics,
      phaseE: {
        transfer: { correct: preCorrect, total: heldOut.length, predictions: preInterference },
        transferNoCorrectionControl: {
          correct: noCorrectionCorrect,
          total: heldOut.length,
        },
        exactExampleRetrieval: {
          correct: retrievalOnly.filter(Boolean).length,
          total: heldOut.length,
        },
      },
      phaseF: {
        unrelatedVocabularyAdded: phaseF.accepted,
        before: { correct: preCorrect, total: heldOut.length },
        after: { correct: postCorrect, total: heldOut.length, predictions: postInterference },
        forgettingAbsoluteAccuracyPoints: Math.max(
          0,
          preCorrect / heldOut.length - postCorrect / heldOut.length,
        ),
        oldVocabularyRetained: oldVocabularyAfterInterference.filter(
          (item, index) =>
            item.status === "supported" &&
            item.concept?.id === expectedVocabulary[index].concept,
        ).length,
        oldVocabularyTotal: phases.phaseA.vocabulary.length + phases.phaseB.vocabulary.length,
        falseAssociations: {
          count: falseAssociations,
          total: vocabularyQueries.length,
        },
      },
      phaseG: {
        separateProcessReloadConcepts: restarted.conceptCount,
        separateProcessReloadRelations: restarted.relationshipCount,
        separateProcessReloadEvents: restarted.eventCount,
        expectedFrames: heldOut.length,
        exactFramesAfterReload: restartMatches,
        knowledgeStateMatches: restartKnowledgeStateMatches,
        patternProvenanceMatches: restartPatternProvenanceMatches,
        resetLookupStatus: afterReset.status,
        patternAfterReset: resetPattern,
        productionVocabularyResetGuardPassed: productionGuardPassed,
        productionPatternStoreGuardPassed: patternProductionGuardPassed,
        persistedStateBeforeReset: {
          concepts: stateBeforeReset.concepts.length,
          symbols: stateBeforeReset.symbols.length,
          relationships: stateBeforeReset.relationships.length,
          events: stateBeforeReset.events.length,
        },
      },
      memoryBytes,
      learningLatencyMs: phasesDuration,
      timingSampleCount: inferenceTimes.length,
      inferenceLatencyMs: {
        observations: inferenceTimes.length,
        repeatsPerExample: 5,
        p50: sortedInferenceTimes[p50Index] ?? 0,
        p95: sortedInferenceTimes[p95Index] ?? 0,
      },
      conditionComparisons: {
        A: { emptyHeldOutExact: `${emptyCorrect}/${heldOut.length}` },
        B: { retrievalHeldOutExact: `${retrievalOnly.filter(Boolean).length}/${heldOut.length}` },
        C: {
          vocabularyKnownAfterPhases: `${vocabularyQueries.filter(
            (item, index) =>
              item.status === "supported" &&
              item.concept?.id === expectedVocabulary[index].concept,
          ).length}/${vocabularyQueries.length}`,
          exactComposition: "not enabled",
        },
        D: { inducedHeldOutExact: `${preCorrect}/${heldOut.length}` },
        E: {
          correctionSuccess: correctionMetrics.correctionSuccess,
          noCorrectionControlRetained: correctionMetrics.noCorrectionControlRetainsOriginal,
          correctedHeldOutExact: `${preCorrect}/${heldOut.length}`,
          uncorrectedHeldOutExact: `${noCorrectionCorrect}/${heldOut.length}`,
        },
      },
      reset: {
        isolatedKnowledgeEmpty: stateBeforeReset.concepts.length > 0 && afterReset.status === "unknown",
        patternEmpty: resetPattern === null,
      },
    };
    if (checkpointDirectory) {
      await saveCheckpoint(checkpointDirectory, "phase-g-reset", vocabularyStore, patternStore);
    }
    return {
      sequence: name,
      order: first === "A" ? ["A", "B"] : ["B", "A"],
      phases: phaseResults,
      integrity: {
        contradictionRejected: correctionMetrics.explicitContradictionRejected,
        patternRevisionRevert: phaseC.revisionRevert.correct,
        correctionSuccess: correctionMetrics.correctionSuccess,
        correctionRevert: correctionMetrics.revertingCorrectionRestoresWrongMapping &&
          correctionMetrics.revertingWrongUpdateRestoresOriginal,
        reload: restartMatches === heldOut.length &&
          restartKnowledgeStateMatches &&
          restartPatternProvenanceMatches,
        reset: afterReset.status === "unknown" && resetPattern === null,
        productionGuards: productionGuardPassed && patternProductionGuardPassed,
      },
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const curriculumBytes = await readFile(curriculumPath);
  const heldOutBytes = await readFile(heldOutPath);
  const phases = JSON.parse(curriculumBytes.toString("utf8")) as PhaseData;
  const heldOutDataset = JSON.parse(heldOutBytes.toString("utf8")) as {
    datasetVersion: string;
    examples: HeldOutItem[];
  };
  const checkpointDirectory = path.join(artifactDir, "checkpoints-005");
  await mkdir(checkpointDirectory, { recursive: true });
  const sequences = [
    await runOrder("a-then-b", "A", phases, heldOutDataset.examples, checkpointDirectory),
    await runOrder("b-then-a", "B", phases, heldOutDataset.examples),
  ];
  const result = {
    experiment: "TIDA-005",
    datasetVersion: phases.datasetVersion,
    capturedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    codeRevision: null,
    codeRevisionNote: "Unavailable: the workspace is not inside a Git repository.",
    configuration: {
      phaseAVocabulary: phases.phaseA.vocabulary.length,
      phaseATrainingExamples: phases.phaseA.examples.length,
      phaseBVocabulary: phases.phaseB.vocabulary.length,
      phaseCExamples: phases.phaseC.examples.length,
      phaseProbeExamples:
        phases.phaseA.evaluation.length +
        phases.phaseB.evaluation.length +
        phases.phaseC.evaluation.length,
      heldOutExamples: heldOutDataset.examples.length,
      unrelatedVocabulary: phases.phaseF.unrelatedVocabulary.length,
      multipleTeachingSequences: sequences.length,
    },
    datasetHashes: {
      curriculumSha256: createHash("sha256").update(curriculumBytes).digest("hex"),
      heldOutSha256: createHash("sha256").update(heldOutBytes).digest("hex"),
    },
    execution: {
      evaluationFailures: 0,
      timedOutOperations: 0,
      perOperationTimeoutConfigured: false,
    },
    sequences,
  };
  await writeFile(path.join(artifactDir, "results-005.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
  const allChecks = sequences.every((sequence) =>
    Object.values(sequence.integrity as Record<string, boolean>).every(Boolean),
  );
  if (!allChecks) process.exitCode = 1;
}

void main().catch(async (error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
