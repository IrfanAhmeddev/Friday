import { detectActionConcept } from "./action-concept-engine";
import { createEmbedding } from "../ml/embedding.engine";
import { cosineSimilarity } from "../ml/semantic.matcher";
import {
  extractWorkspaceObject,
  type WorkspaceObject,
} from "./entity-extraction-engine";
import {
  TRAINING_EXAMPLES,
  type TrainingExample,
} from "../training/intent-training";
import { enrichWithJsonKnowledge } from "./json-enrichment-engine";

export type IntentType =
  | "workspace.create"
  | "workspace.open"
  | "workspace.search"
  | "workspace.show"
  | "workspace.rename"
  | "workspace.delete"
  | "workspace.close"
  | "workspace.edit"
  | "unknown";

export interface HybridIntentResult {
  intent: IntentType;
  confidence: number;

  lexicalScore: number;
  semanticScore: number;
  keywordScore: number;

  actionConcept: string;
  matchedTrainingText: string | null;

  workspaceObject: WorkspaceObject;
  workspaceObjectMatchedText: string | null;
  workspaceObjectConfidence: number;

  jsonPatternIntent: string | null;
  jsonPatternConfidence: number;
  jsonCanonicalTerms: string[];
  jsonRelatedActions: string[];
}

interface ScoredTrainingExample extends TrainingExample {
  lexicalScore: number;
  semanticScore: number;
  keywordScore: number;
  finalScore: number;
}

const LEXICAL_WEIGHT = 0.3;
const SEMANTIC_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.2;

const UNKNOWN_THRESHOLD = 0.35;
const UNCERTAIN_MARGIN = 0.08;
const ACTION_OVERRIDE_CONFIDENCE = 0.8;
const JSON_PATTERN_CONFIDENCE_THRESHOLD = 0.65;

export type EmbeddingProvider = (text: string) => Promise<number[]>;

const trainingEmbeddings = new WeakMap<
  EmbeddingProvider,
  Promise<number[][]>
>();

function getTrainingEmbeddings(
  embeddingProvider: EmbeddingProvider,
): Promise<number[][]> {
  const cached = trainingEmbeddings.get(embeddingProvider);
  if (cached) {
    return cached;
  }

  let pending: Promise<number[][]>;
  pending = Promise.resolve()
    .then(async () => {
      const embeddings: number[][] = [];

      for (const example of TRAINING_EXAMPLES) {
        embeddings.push(await embeddingProvider(example.text));
      }

      return embeddings;
    })
    .catch((error: unknown) => {
      if (trainingEmbeddings.get(embeddingProvider) === pending) {
        trainingEmbeddings.delete(embeddingProvider);
      }
      throw error;
    });

  trainingEmbeddings.set(embeddingProvider, pending);
  return pending;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean);
}

function calculateLexicalScore(
  input: string,
  candidate: string,
): number {
  const inputTokens = tokenize(input);
  const candidateTokens = tokenize(candidate);

  if (
    inputTokens.length === 0 ||
    candidateTokens.length === 0
  ) {
    return 0;
  }

  const candidateSet = new Set(candidateTokens);

  let matchedTokens = 0;

  for (const token of inputTokens) {
    if (candidateSet.has(token)) {
      matchedTokens++;
    }
  }

  return matchedTokens / inputTokens.length;
}

function calculateKeywordScore(
  input: string,
  keywords: string[],
): number {
  const normalizedInput = normalizeText(input);
  const inputTokens = new Set(tokenize(input));

  if (keywords.length === 0) {
    return 0;
  }

  let matchedKeywords = 0;

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);

    if (
      inputTokens.has(normalizedKeyword) ||
      normalizedInput.includes(normalizedKeyword)
    ) {
      matchedKeywords++;
    }
  }

  return matchedKeywords / keywords.length;
}

function mapActionToIntent(
  action: string,
): IntentType | null {
  switch (action) {
    case "create":
      return "workspace.create";

    case "open":
      return "workspace.open";

    case "search":
      return "workspace.search";

    case "show":
      return "workspace.show";

    case "rename":
      return "workspace.rename";

    case "delete":
      return "workspace.delete";

    case "close":
      return "workspace.close";

    case "edit":
      return "workspace.edit";

    default:
      return null;
  }
}

function isWorkspaceIntent(
  intent: string | null,
): intent is Exclude<IntentType, "unknown"> {
  return (
    intent === "workspace.create" ||
    intent === "workspace.open" ||
    intent === "workspace.search" ||
    intent === "workspace.show" ||
    intent === "workspace.rename" ||
    intent === "workspace.delete" ||
    intent === "workspace.close" ||
    intent === "workspace.edit"
  );
}

function createUnknownResult(
  actionConcept: string,
  entityResult: {
    workspaceObject: WorkspaceObject;
    matchedText: string | null;
    confidence: number;
  },
  jsonKnowledge: {
    patternMatch: {
      intent: string | null;
      confidence: number;
    };
    canonicalTerms: string[];
    relatedActions: string[];
  },
): HybridIntentResult {
  return {
    intent: "unknown",
    confidence: 0,

    lexicalScore: 0,
    semanticScore: 0,
    keywordScore: 0,

    actionConcept,
    matchedTrainingText: null,

    workspaceObject: entityResult.workspaceObject,
    workspaceObjectMatchedText: entityResult.matchedText,
    workspaceObjectConfidence: entityResult.confidence,

    jsonPatternIntent: jsonKnowledge.patternMatch.intent,
    jsonPatternConfidence: jsonKnowledge.patternMatch.confidence,
    jsonCanonicalTerms: jsonKnowledge.canonicalTerms,
    jsonRelatedActions: jsonKnowledge.relatedActions,
  };
}

export async function understandIntent(
  input: string,
  embeddingProvider: EmbeddingProvider = createEmbedding,
): Promise<HybridIntentResult> {
  const entityResult = extractWorkspaceObject(input);
  const actionResult = detectActionConcept(input);
  const jsonKnowledge = enrichWithJsonKnowledge(input);

  const actionConcept = actionResult.action;
  const actionIntent = mapActionToIntent(actionConcept);

  const jsonPatternIntent = isWorkspaceIntent(
    jsonKnowledge.patternMatch.intent,
  )
    ? jsonKnowledge.patternMatch.intent
    : null;

  const hasReliableJsonPattern =
    jsonPatternIntent !== null &&
    jsonKnowledge.patternMatch.confidence >=
      JSON_PATTERN_CONFIDENCE_THRESHOLD;

  const hasWorkspaceEntity =
    entityResult.workspaceObject !== "unknown" &&
    entityResult.confidence > 0;

  const hasReliableActionConcept =
    actionIntent !== null &&
    actionResult.confidence >= ACTION_OVERRIDE_CONFIDENCE;

  if (input.trim().length === 0) {
    return createUnknownResult(
      actionConcept,
      entityResult,
      jsonKnowledge,
    );
  }

  const hasAnyStructuredWorkspaceSignal =
    hasReliableActionConcept ||
    hasReliableJsonPattern ||
    hasWorkspaceEntity;

  if (!hasAnyStructuredWorkspaceSignal) {
    return createUnknownResult(
      actionConcept,
      entityResult,
      jsonKnowledge,
    );
  }

  const inputEmbedding = await embeddingProvider(input);
  const exampleEmbeddings =
    await getTrainingEmbeddings(embeddingProvider);

  const scoredExamples: ScoredTrainingExample[] = [];

  for (const [index, example] of TRAINING_EXAMPLES.entries()) {
    const exampleEmbedding = exampleEmbeddings[index];

    if (!exampleEmbedding) {
      throw new Error(
        `Missing cached embedding for training example ${index}.`,
      );
    }

    const lexicalScore = calculateLexicalScore(
      input,
      example.text,
    );

    const semanticScore = cosineSimilarity(
      inputEmbedding,
      exampleEmbedding,
    );

    const keywordScore = calculateKeywordScore(
      input,
      example.keywords,
    );

    const finalScore =
      lexicalScore * LEXICAL_WEIGHT +
      semanticScore * SEMANTIC_WEIGHT +
      keywordScore * KEYWORD_WEIGHT;

    scoredExamples.push({
      ...example,
      lexicalScore,
      semanticScore,
      keywordScore,
      finalScore,
    });
  }

  scoredExamples.sort(
    (a, b) => b.finalScore - a.finalScore,
  );

  const bestMatch = scoredExamples[0];
  const secondBestMatch = scoredExamples[1];

  if (!bestMatch) {
    return createUnknownResult(
      actionConcept,
      entityResult,
      jsonKnowledge,
    );
  }

  const scoreMargin = secondBestMatch
    ? bestMatch.finalScore - secondBestMatch.finalScore
    : bestMatch.finalScore;

  const isBelowUnknownThreshold =
    bestMatch.finalScore < UNKNOWN_THRESHOLD;

  const isUncertain =
    scoreMargin < UNCERTAIN_MARGIN;

  const shouldUseActionOverride =
    actionIntent !== null &&
    actionResult.confidence >= ACTION_OVERRIDE_CONFIDENCE;

  const shouldUseJsonOverride =
    hasReliableJsonPattern &&
    jsonPatternIntent !== null;

  if (
    isBelowUnknownThreshold &&
    !shouldUseActionOverride &&
    !shouldUseJsonOverride
  ) {
    return createUnknownResult(
      actionConcept,
      entityResult,
      jsonKnowledge,
    );
  }

  if (
    isUncertain &&
    !shouldUseActionOverride &&
    !shouldUseJsonOverride &&
    bestMatch.finalScore < 0.6
  ) {
    return createUnknownResult(
      actionConcept,
      entityResult,
      jsonKnowledge,
    );
  }

  const bestIntent = bestMatch.intent as IntentType;

  let finalIntent: IntentType;

  if (shouldUseActionOverride && actionIntent !== null) {
    finalIntent = actionIntent;
  } else if (
    shouldUseJsonOverride &&
    jsonPatternIntent !== null
  ) {
    finalIntent = jsonPatternIntent;
  } else {
    finalIntent = bestIntent;
  }

  const finalConfidence = Number(
    Math.min(
      0.99,
      Math.max(
        0,
        shouldUseActionOverride
          ? Math.max(
              bestMatch.finalScore,
              actionResult.confidence,
            )
          : shouldUseJsonOverride
            ? Math.max(
                bestMatch.finalScore,
                jsonKnowledge.patternMatch.confidence,
              )
            : bestMatch.finalScore,
      ),
    ).toFixed(2),
  );

  return {
    intent: finalIntent,
    confidence: finalConfidence,

    lexicalScore: Number(
      bestMatch.lexicalScore.toFixed(4),
    ),

    semanticScore: Number(
      bestMatch.semanticScore.toFixed(4),
    ),

    keywordScore: Number(
      bestMatch.keywordScore.toFixed(4),
    ),

    actionConcept,
    matchedTrainingText: bestMatch.text,

    workspaceObject: entityResult.workspaceObject,
    workspaceObjectMatchedText: entityResult.matchedText,
    workspaceObjectConfidence: entityResult.confidence,

    jsonPatternIntent: jsonKnowledge.patternMatch.intent,
    jsonPatternConfidence: jsonKnowledge.patternMatch.confidence,
    jsonCanonicalTerms: jsonKnowledge.canonicalTerms,
    jsonRelatedActions: jsonKnowledge.relatedActions,
  };
}

export async function classifyIntent(
  input: string,
): Promise<HybridIntentResult> {
  return understandIntent(input);
}