"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadJsonKnowledge = loadJsonKnowledge;
exports.resetJsonKnowledgeCache = resetJsonKnowledgeCache;
exports.normalizeKnowledgeText = normalizeKnowledgeText;
exports.lookupVocabulary = lookupVocabulary;
exports.findCanonicalTerms = findCanonicalTerms;
exports.matchPattern = matchPattern;
exports.extractEntityFromKnowledge = extractEntityFromKnowledge;
let cachedKnowledge = null;
let cachedIndexes = null;
const bundledKnowledgeFiles = {
    "vocabulary.json": require("../../data/vocabulary.json"),
    "synonyms.json": require("../../data/synonyms.json"),
    "patterns.json": require("../../data/patterns.json"),
    "entities.json": require("../../data/entities.json"),
};
function loadJsonFile(fileName) {
    return bundledKnowledgeFiles[fileName];
}
function validateKnowledge(knowledge) {
    if (!knowledge.vocabulary ||
        typeof knowledge.vocabulary !== "object") {
        throw new Error("Invalid vocabulary.json: expected an object.");
    }
    if (!knowledge.synonyms ||
        typeof knowledge.synonyms !== "object") {
        throw new Error("Invalid synonyms.json: expected an object.");
    }
    if (!knowledge.patterns ||
        typeof knowledge.patterns !== "object") {
        throw new Error("Invalid patterns.json: expected an object.");
    }
    if (!knowledge.entities ||
        typeof knowledge.entities !== "object") {
        throw new Error("Invalid entities.json: expected an object.");
    }
}
function loadJsonKnowledge() {
    if (cachedKnowledge) {
        return cachedKnowledge;
    }
    const knowledge = {
        vocabulary: loadJsonFile("vocabulary.json"),
        synonyms: loadJsonFile("synonyms.json"),
        patterns: loadJsonFile("patterns.json"),
        entities: loadJsonFile("entities.json"),
    };
    validateKnowledge(knowledge);
    cachedKnowledge = knowledge;
    return cachedKnowledge;
}
function resetJsonKnowledgeCache() {
    cachedKnowledge = null;
    cachedIndexes = null;
}
function normalizeKnowledgeText(input) {
    return input
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}
/**
 * Checks whether a complete word or phrase exists
 * inside normalized text.
 *
 * Padding both strings with spaces prevents partial
 * matches such as:
 *
 * "work" matching "workspace"
 * "project" matching "projectsomething"
 */
function containsCompletePhrase(normalizedText, normalizedPhrase) {
    if (!normalizedText || !normalizedPhrase) {
        return false;
    }
    const paddedText = ` ${normalizedText} `;
    const paddedPhrase = ` ${normalizedPhrase} `;
    return paddedText.includes(paddedPhrase);
}
/**
 * Creates normalized indexes once and reuses them.
 * This avoids repeatedly normalizing the same JSON data
 * for every user request.
 */
function buildKnowledgeIndexes() {
    if (cachedIndexes) {
        return cachedIndexes;
    }
    const knowledge = loadJsonKnowledge();
    const canonicalTerms = Object.keys(knowledge.vocabulary)
        .map(normalizeKnowledgeText)
        .filter(Boolean)
        .sort((first, second) => {
        return second.length - first.length;
    });
    const synonymEntries = Object.entries(knowledge.synonyms)
        .map(([synonym, canonicalTerm]) => ({
        normalizedSynonym: normalizeKnowledgeText(synonym),
        canonicalTerm: normalizeKnowledgeText(canonicalTerm),
    }))
        .filter((entry) => entry.normalizedSynonym.length > 0 &&
        entry.canonicalTerm.length > 0)
        .sort((first, second) => {
        return (second.normalizedSynonym.length -
            first.normalizedSynonym.length);
    });
    const entityAliases = [];
    for (const [entityType, aliases] of Object.entries(knowledge.entities)) {
        for (const alias of aliases) {
            const normalizedAlias = normalizeKnowledgeText(alias);
            if (!normalizedAlias) {
                continue;
            }
            entityAliases.push({
                normalizedAlias,
                entityType,
                originalAlias: alias,
            });
        }
    }
    entityAliases.sort((first, second) => {
        return (second.normalizedAlias.length -
            first.normalizedAlias.length);
    });
    const patterns = [];
    for (const [intent, intentPatterns] of Object.entries(knowledge.patterns)) {
        for (const pattern of intentPatterns) {
            const normalizedPattern = normalizeKnowledgeText(pattern);
            if (!normalizedPattern) {
                continue;
            }
            patterns.push({
                intent,
                originalPattern: pattern,
                normalizedPattern,
            });
        }
    }
    patterns.sort((first, second) => {
        return (second.normalizedPattern.length -
            first.normalizedPattern.length);
    });
    cachedIndexes = {
        canonicalTerms,
        synonymEntries,
        entityAliases,
        patterns,
    };
    return cachedIndexes;
}
function lookupVocabulary(input) {
    const knowledge = loadJsonKnowledge();
    const normalizedInput = normalizeKnowledgeText(input);
    if (!normalizedInput) {
        return {
            input,
            canonicalTerm: null,
            meaning: null,
            relatedActions: [],
            matchedBy: "none",
        };
    }
    const canonicalEntry = knowledge.vocabulary[normalizedInput];
    if (canonicalEntry) {
        return {
            input,
            canonicalTerm: normalizedInput,
            meaning: canonicalEntry.meaning,
            relatedActions: canonicalEntry.relatedActions ?? [],
            matchedBy: "canonical",
        };
    }
    const indexes = buildKnowledgeIndexes();
    const matchedSynonym = indexes.synonymEntries.find((entry) => entry.normalizedSynonym === normalizedInput);
    if (!matchedSynonym) {
        return {
            input,
            canonicalTerm: null,
            meaning: null,
            relatedActions: [],
            matchedBy: "none",
        };
    }
    const vocabularyEntry = knowledge.vocabulary[matchedSynonym.canonicalTerm];
    return {
        input,
        canonicalTerm: matchedSynonym.canonicalTerm,
        meaning: vocabularyEntry?.meaning ?? null,
        relatedActions: vocabularyEntry?.relatedActions ?? [],
        matchedBy: "synonym",
    };
}
function findCanonicalTerms(input) {
    const normalizedInput = normalizeKnowledgeText(input);
    if (!normalizedInput) {
        return [];
    }
    const indexes = buildKnowledgeIndexes();
    const matchedTerms = new Set();
    for (const canonicalTerm of indexes.canonicalTerms) {
        if (containsCompletePhrase(normalizedInput, canonicalTerm)) {
            matchedTerms.add(canonicalTerm);
        }
    }
    for (const synonymEntry of indexes.synonymEntries) {
        if (containsCompletePhrase(normalizedInput, synonymEntry.normalizedSynonym)) {
            matchedTerms.add(synonymEntry.canonicalTerm);
        }
    }
    return [...matchedTerms];
}
function calculatePatternConfidence(normalizedPattern) {
    const tokenCount = normalizedPattern.split(" ").filter(Boolean)
        .length;
    const characterScore = Math.min(0.2, normalizedPattern.length / 100);
    const tokenScore = Math.min(0.15, tokenCount * 0.04);
    return Number(Math.min(0.98, 0.6 + characterScore + tokenScore).toFixed(2));
}
function matchPattern(input) {
    const normalizedInput = normalizeKnowledgeText(input);
    if (!normalizedInput) {
        return {
            input,
            intent: null,
            matchedPattern: null,
            confidence: 0,
        };
    }
    const indexes = buildKnowledgeIndexes();
    const matchedPattern = indexes.patterns.find((pattern) => containsCompletePhrase(normalizedInput, pattern.normalizedPattern));
    if (!matchedPattern) {
        return {
            input,
            intent: null,
            matchedPattern: null,
            confidence: 0,
        };
    }
    return {
        input,
        intent: matchedPattern.intent,
        matchedPattern: matchedPattern.originalPattern,
        confidence: calculatePatternConfidence(matchedPattern.normalizedPattern),
    };
}
function extractEntityFromKnowledge(input) {
    const normalizedInput = normalizeKnowledgeText(input);
    if (!normalizedInput) {
        return {
            input,
            entityType: null,
            matchedText: null,
            confidence: 0,
        };
    }
    const indexes = buildKnowledgeIndexes();
    const matchedEntity = indexes.entityAliases.find((entity) => containsCompletePhrase(normalizedInput, entity.normalizedAlias));
    if (!matchedEntity) {
        return {
            input,
            entityType: null,
            matchedText: null,
            confidence: 0,
        };
    }
    return {
        input,
        entityType: matchedEntity.entityType,
        matchedText: matchedEntity.originalAlias,
        confidence: 0.95,
    };
}
