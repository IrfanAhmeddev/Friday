import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_KNOWLEDGE_STORE_PATH,
} from "./memory-store";

export type PatternRole = "subject" | "predicate" | "object";
export type PatternSource = "induced" | "supplied";

export interface PatternFrame {
  subject: string;
  predicate: string;
  object: string;
}

export interface LabeledPatternExample {
  id: string;
  tokens: [string, string, string];
  frame: PatternFrame;
  source?: string;
}

export interface PatternCandidate {
  rolesByPosition: [PatternRole, PatternRole, PatternRole];
  supportingEvidenceIds: string[];
  contradictionEvidenceIds: string[];
  score: number;
}

export interface GrammarPatternSnapshot {
  schemaVersion: 1;
  id: string;
  version: number;
  status: "accepted" | "ambiguous" | "rejected";
  source: PatternSource;
  pattern: [PatternRole, PatternRole, PatternRole] | null;
  confidence: number;
  evidenceIds: string[];
  evidenceSources: Array<{ id: string; source: string }>;
  candidates: PatternCandidate[];
  reason: string;
  createdAt: string;
}

export interface PatternInterpretation {
  status: "supported" | "ambiguous" | "unknown" | "unsupported" | "degraded";
  frame: PatternFrame | null;
  recognizedTokens: string[];
  patternId: string | null;
  patternVersion: number | null;
  source: PatternSource | null;
  provenance: string[];
  confidence: number | null;
  reason: string | null;
}

const ROLES: PatternRole[] = ["subject", "predicate", "object"];
const MAX_EXAMPLES = 64;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function permutations<T>(items: T[]): T[][] {
  const result: T[][] = [];
  const visit = (prefix: T[], rest: T[]): void => {
    if (rest.length === 0) {
      result.push(prefix);
      return;
    }
    for (let index = 0; index < rest.length; index++) {
      visit(
        [...prefix, rest[index]],
        [...rest.slice(0, index), ...rest.slice(index + 1)],
      );
    }
  };
  visit([], items);
  return result;
}

function canonicalExample(example: LabeledPatternExample): string {
  return JSON.stringify({
    tokens: example.tokens.map(normalize),
    frame: {
      subject: normalize(example.frame.subject),
      predicate: normalize(example.frame.predicate),
      object: normalize(example.frame.object),
    },
  });
}

function distinctExamples(
  examples: LabeledPatternExample[],
): LabeledPatternExample[] {
  const seen = new Set<string>();
  return examples.filter((example) => {
    const canonical = canonicalExample(example);
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function candidateMatches(
  roles: PatternRole[],
  example: LabeledPatternExample,
): boolean {
  return roles.every(
    (role, index) =>
      normalize(example.tokens[index]) === normalize(example.frame[role]),
  );
}

function makeSnapshot(
  examples: LabeledPatternExample[],
  version: number,
  source: PatternSource,
): GrammarPatternSnapshot {
  if (examples.length > MAX_EXAMPLES) {
    throw new Error(`Pattern evidence limit exceeded (${MAX_EXAMPLES}).`);
  }
  const uniqueExamples = distinctExamples(examples).sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  if (
    uniqueExamples.some(
      (example) =>
        !example.id.trim() ||
        example.tokens.some((token) => !token.trim()) ||
        ROLES.some((role) => !example.frame[role].trim()),
    )
  ) {
    throw new Error("Pattern examples require an id, three tokens, and a complete frame.");
  }

  const candidates: PatternCandidate[] = permutations(ROLES).map((permutation) => {
    const support = uniqueExamples
      .filter((example) => candidateMatches(permutation, example))
      .map((example) => example.id);
    const contradictions = uniqueExamples
      .filter((example) => !candidateMatches(permutation, example))
      .map((example) => example.id);
    return {
      rolesByPosition: permutation as PatternCandidate["rolesByPosition"],
      supportingEvidenceIds: support,
      contradictionEvidenceIds: contradictions,
      score: uniqueExamples.length === 0 ? 0 : support.length / uniqueExamples.length,
    };
  }).sort(
    (left, right) =>
      right.score - left.score ||
      left.rolesByPosition.join(",").localeCompare(right.rolesByPosition.join(",")),
  );

  const best = candidates[0];
  const runnerUp = candidates[1];
  const enoughEvidence = uniqueExamples.length >= 2;
  const uniqueBest = best.score > (runnerUp?.score ?? 0);
  const confidence =
    best.score * Math.min(1, uniqueExamples.length / 2);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      version,
      source,
      examples: uniqueExamples.map((example) => ({
        id: example.id,
        canonical: canonicalExample(example),
      })),
    }))
    .digest("hex")
    .slice(0, 16);
  const accepted =
    enoughEvidence &&
    uniqueBest &&
    best.score === 1 &&
    best.contradictionEvidenceIds.length === 0;

  return {
    schemaVersion: 1,
    id: `pattern-${version}-${fingerprint}`,
    version,
    status: accepted
      ? "accepted"
      : !enoughEvidence || !uniqueBest
        ? "ambiguous"
        : "rejected",
    source,
    pattern: accepted ? best.rolesByPosition : null,
    confidence,
    evidenceIds: uniqueExamples.map((example) => example.id),
    evidenceSources: uniqueExamples.map((example) => ({
      id: example.id,
      source: example.source ?? "weak-supervision",
    })),
    candidates,
    reason: accepted
      ? `Unique candidate supported by ${best.supportingEvidenceIds.length} distinct labeled examples.`
      : !enoughEvidence
        ? "At least two distinct labeled examples are required."
        : !uniqueBest
          ? "Multiple candidate patterns remain equally supported."
          : "The best candidate conflicts with at least one labeled example.",
    createdAt: new Date().toISOString(),
  };
}

export function induceGrammarPattern(
  examples: LabeledPatternExample[],
  version = 1,
): GrammarPatternSnapshot {
  return makeSnapshot(examples, version, "induced");
}

export function supplyGrammarPattern(
  id: string,
  rolesByPosition: [PatternRole, PatternRole, PatternRole],
  version = 1,
): GrammarPatternSnapshot {
  if (
    new Set(rolesByPosition).size !== 3 ||
    rolesByPosition.some((role) => !ROLES.includes(role))
  ) {
    throw new Error("Supplied pattern must assign each role exactly once.");
  }
  return {
    schemaVersion: 1,
    id,
    version,
    status: "accepted",
    source: "supplied",
    pattern: [...rolesByPosition] as PatternCandidate["rolesByPosition"],
    confidence: 1,
    evidenceIds: [],
    evidenceSources: [],
    candidates: [],
    reason: "Pattern was directly supplied; this is a reference condition, not induction.",
    createdAt: new Date().toISOString(),
  };
}

export function analyzeUnlabeledPatternAmbiguity(
  sentences: string[][],
): PatternCandidate[] {
  if (sentences.length > MAX_EXAMPLES || sentences.some(
    (sentence) => sentence.length !== 3 || sentence.some((token) => !token.trim()),
  )) {
    throw new Error(`Unlabeled pattern input must contain at most ${MAX_EXAMPLES} three-token sentences.`);
  }
  return permutations(ROLES).map((permutation) => ({
    rolesByPosition: permutation as PatternCandidate["rolesByPosition"],
    supportingEvidenceIds: [],
    contradictionEvidenceIds: [],
    score: sentences.length === 0 ? 0 : 1,
  }));
}

function validateSnapshot(value: unknown): GrammarPatternSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    (value as GrammarPatternSnapshot).schemaVersion !== 1 ||
    !Array.isArray((value as GrammarPatternSnapshot).candidates) ||
    !Array.isArray((value as GrammarPatternSnapshot).evidenceIds) ||
    !Array.isArray((value as GrammarPatternSnapshot).evidenceSources)
  ) {
    throw new Error("Invalid grammar-pattern store or unsupported schema version.");
  }
  return value as GrammarPatternSnapshot;
}

export class GrammarPatternStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    const productionPath = path.resolve(DEFAULT_KNOWLEDGE_STORE_PATH);
    const samePath = process.platform === "win32"
      ? this.filePath.toLocaleLowerCase() === productionPath.toLocaleLowerCase()
      : this.filePath === productionPath;
    if (samePath) {
      throw new Error("Grammar-pattern store cannot use FRIDAY's production memory path.");
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  async read(): Promise<GrammarPatternSnapshot | null> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch (error) {
      throw new Error(`Could not parse grammar-pattern store: ${error instanceof Error ? error.message : String(error)}`);
    }
    return validateSnapshot(parsed);
  }

  async write(snapshot: GrammarPatternSnapshot): Promise<void> {
    validateSnapshot(snapshot);
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }

  async reset(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

export async function interpretWithGrammarPattern(
  text: string,
  store: GrammarPatternStore,
  conceptsByToken: Record<string, string> = {},
  knownTokens?: string[],
): Promise<PatternInterpretation> {
  const snapshot = await store.read();
  const tokens = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const base = {
    recognizedTokens: tokens,
    patternId: snapshot?.id ?? null,
    patternVersion: snapshot?.version ?? null,
    source: snapshot?.source ?? null,
    provenance: snapshot?.evidenceIds ?? [],
    confidence: snapshot?.confidence ?? null,
  };
  if (/\b(?:not|never|without|don't|doesn't|didn't|cannot|can't)\b/i.test(text)) {
    return {
      ...base,
      status: "unsupported",
      frame: null,
      reason: "Explicit negation prevented learned pattern interpretation.",
    };
  }
  if (!snapshot) {
    return { ...base, status: "ambiguous", frame: null, reason: "No stored pattern is available." };
  }
  if (tokens.length !== 3) {
    return {
      ...base,
      status: "unsupported",
      frame: null,
      reason: `Expected exactly three tokens; received ${tokens.length}.`,
    };
  }
  const normalizedKnownTokens = knownTokens?.map(normalize);
  const unknownToken = normalizedKnownTokens
    ? tokens.find((token) => !normalizedKnownTokens.includes(normalize(token)))
    : undefined;
  if (unknownToken) {
    return {
      ...base,
      status: "unknown",
      frame: null,
      reason: `Token "${unknownToken}" is not in the learned vocabulary.`,
    };
  }
  if (snapshot.status !== "accepted" || !snapshot.pattern) {
    return { ...base, status: "ambiguous", frame: null, reason: snapshot.reason };
  }
  const concepts = tokens.map((token) => conceptsByToken[normalize(token)] ?? token);
  const frame: PatternFrame = { subject: "", predicate: "", object: "" };
  for (let index = 0; index < 3; index++) {
    frame[snapshot.pattern[index]] = concepts[index];
  }
  return {
    ...base,
    status: "supported",
    frame,
    reason: null,
  };
}
