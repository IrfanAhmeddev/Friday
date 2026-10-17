"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.understandIntent = understandIntent;
exports.classifyIntent = classifyIntent;
const action_concept_engine_1 = require("./action-concept-engine");
const embedding_engine_1 = require("../ml/embedding.engine");
const semantic_matcher_1 = require("../ml/semantic.matcher");
const entity_extraction_engine_1 = require("./entity-extraction-engine");
const intent_training_1 = require("../training/intent-training");
const json_enrichment_engine_1 = require("./json-enrichment-engine");
const LEXICAL_WEIGHT = 0.3;
const SEMANTIC_WEIGHT = 0.5;
const KEYWORD_WEIGHT = 0.2;
const UNKNOWN_THRESHOLD = 0.35;
const UNCERTAIN_MARGIN = 0.08;
const ACTION_OVERRIDE_CONFIDENCE = 0.8;
const JSON_PATTERN_CONFIDENCE_THRESHOLD = 0.65;
const trainingEmbeddings = new WeakMap();
function getTrainingEmbeddings(embeddingProvider) {
    const cached = trainingEmbeddings.get(embeddingProvider);
    if (cached) {
        return cached;
    }
    let pending;
    pending = Promise.resolve()
        .then(async () => {
        const embeddings = [];
        for (const example of intent_training_1.TRAINING_EXAMPLES) {
            embeddings.push(await embeddingProvider(example.text));
        }
        return embeddings;
    })
        .catch((error) => {
        if (trainingEmbeddings.get(embeddingProvider) === pending) {
            trainingEmbeddings.delete(embeddingProvider);
        }
        throw error;
    });
    trainingEmbeddings.set(embeddingProvider, pending);
    return pending;
}
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function tokenize(text) {
    return normalizeText(text)
        .split(" ")
        .filter(Boolean);
}
function calculateLexicalScore(input, candidate) {
    const inputTokens = tokenize(input);
    const candidateTokens = tokenize(candidate);
    if (inputTokens.length === 0 ||
        candidateTokens.length === 0) {
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
function calculateKeywordScore(input, keywords) {
    const normalizedInput = normalizeText(input);
    const inputTokens = new Set(tokenize(input));
    if (keywords.length === 0) {
        return 0;
    }
    let matchedKeywords = 0;
    for (const keyword of keywords) {
        const normalizedKeyword = normalizeText(keyword);
        if (inputTokens.has(normalizedKeyword) ||
            normalizedInput.includes(normalizedKeyword)) {
            matchedKeywords++;
        }
    }
    return matchedKeywords / keywords.length;
}
function mapActionToIntent(action) {
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
function isWorkspaceIntent(intent) {
    return (intent === "workspace.create" ||
        intent === "workspace.open" ||
        intent === "workspace.search" ||
        intent === "workspace.show" ||
        intent === "workspace.rename" ||
        intent === "workspace.delete" ||
        intent === "workspace.close" ||
        intent === "workspace.edit");
}
function createUnknownResult(actionConcept, entityResult, jsonKnowledge) {
    return {
        intent: "unknown",
        confidence: 0,
        actionAlternatives: [],
        ambiguous: false,
        negated: false,
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
async function understandIntent(input, embeddingProvider = embedding_engine_1.createEmbedding) {
    const entityResult = (0, entity_extraction_engine_1.extractWorkspaceObject)(input);
    const actionResult = (0, action_concept_engine_1.detectActionConcept)(input);
    const jsonKnowledge = (0, json_enrichment_engine_1.enrichWithJsonKnowledge)(input);
    const actionConcept = actionResult.action;
    const actionIntent = mapActionToIntent(actionConcept);
    const jsonPatternIntent = isWorkspaceIntent(jsonKnowledge.patternMatch.intent)
        ? jsonKnowledge.patternMatch.intent
        : null;
    const hasReliableJsonPattern = jsonPatternIntent !== null &&
        jsonKnowledge.patternMatch.confidence >=
            JSON_PATTERN_CONFIDENCE_THRESHOLD;
    const hasWorkspaceEntity = entityResult.workspaceObject !== "unknown" &&
        entityResult.confidence > 0;
    const hasReliableActionConcept = actionIntent !== null &&
        actionResult.confidence >= ACTION_OVERRIDE_CONFIDENCE;
    if (actionResult.negated || actionResult.ambiguous) {
        return {
            ...createUnknownResult("unknown", entityResult, jsonKnowledge),
            actionAlternatives: actionResult.actionAlternatives,
            ambiguous: actionResult.ambiguous,
            negated: actionResult.negated,
        };
    }
    if (input.trim().length === 0) {
        return createUnknownResult(actionConcept, entityResult, jsonKnowledge);
    }
    const hasAnyStructuredWorkspaceSignal = hasReliableActionConcept ||
        hasReliableJsonPattern ||
        hasWorkspaceEntity;
    if (!hasAnyStructuredWorkspaceSignal) {
        return createUnknownResult(actionConcept, entityResult, jsonKnowledge);
    }
    const inputEmbedding = await embeddingProvider(input);
    const exampleEmbeddings = await getTrainingEmbeddings(embeddingProvider);
    const scoredExamples = [];
    for (const [index, example] of intent_training_1.TRAINING_EXAMPLES.entries()) {
        const exampleEmbedding = exampleEmbeddings[index];
        if (!exampleEmbedding) {
            throw new Error(`Missing cached embedding for training example ${index}.`);
        }
        const lexicalScore = calculateLexicalScore(input, example.text);
        const semanticScore = (0, semantic_matcher_1.cosineSimilarity)(inputEmbedding, exampleEmbedding);
        const keywordScore = calculateKeywordScore(input, example.keywords);
        const finalScore = lexicalScore * LEXICAL_WEIGHT +
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
    scoredExamples.sort((a, b) => b.finalScore - a.finalScore);
    const bestMatch = scoredExamples[0];
    const secondBestMatch = scoredExamples[1];
    if (!bestMatch) {
        return createUnknownResult(actionConcept, entityResult, jsonKnowledge);
    }
    const scoreMargin = secondBestMatch
        ? bestMatch.finalScore - secondBestMatch.finalScore
        : bestMatch.finalScore;
    const isBelowUnknownThreshold = bestMatch.finalScore < UNKNOWN_THRESHOLD;
    const isUncertain = scoreMargin < UNCERTAIN_MARGIN;
    const shouldUseActionOverride = actionIntent !== null &&
        actionResult.confidence >= ACTION_OVERRIDE_CONFIDENCE;
    const shouldUseJsonOverride = hasReliableJsonPattern &&
        jsonPatternIntent !== null;
    if (isBelowUnknownThreshold &&
        !shouldUseActionOverride &&
        !shouldUseJsonOverride) {
        return createUnknownResult(actionConcept, entityResult, jsonKnowledge);
    }
    if (isUncertain &&
        !shouldUseActionOverride &&
        !shouldUseJsonOverride &&
        bestMatch.finalScore < 0.6) {
        return createUnknownResult(actionConcept, entityResult, jsonKnowledge);
    }
    const bestIntent = bestMatch.intent;
    let finalIntent;
    if (shouldUseActionOverride && actionIntent !== null) {
        finalIntent = actionIntent;
    }
    else if (shouldUseJsonOverride &&
        jsonPatternIntent !== null) {
        finalIntent = jsonPatternIntent;
    }
    else {
        finalIntent = bestIntent;
    }
    const finalConfidence = Number(Math.min(0.99, Math.max(0, shouldUseActionOverride
        ? Math.max(bestMatch.finalScore, actionResult.confidence)
        : shouldUseJsonOverride
            ? Math.max(bestMatch.finalScore, jsonKnowledge.patternMatch.confidence)
            : bestMatch.finalScore)).toFixed(2));
    return {
        intent: finalIntent,
        confidence: finalConfidence,
        actionAlternatives: actionResult.actionAlternatives,
        ambiguous: false,
        negated: false,
        lexicalScore: Number(bestMatch.lexicalScore.toFixed(4)),
        semanticScore: Number(bestMatch.semanticScore.toFixed(4)),
        keywordScore: Number(bestMatch.keywordScore.toFixed(4)),
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
async function classifyIntent(input) {
    return understandIntent(input);
}
