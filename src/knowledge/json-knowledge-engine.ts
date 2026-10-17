export interface VocabularyEntry {
  meaning: string;
  synonyms: string[];
  relatedActions?: string[];
  entityType?: string;
}

export type VocabularyData = Record<string, VocabularyEntry>;
export type SynonymsData = Record<string, string>;
export type PatternsData = Record<string, string[]>;
export type EntitiesData = Record<string, string[]>;

export interface JsonKnowledgeData {
  vocabulary: VocabularyData;
  synonyms: SynonymsData;
  patterns: PatternsData;
  entities: EntitiesData;
}

export interface VocabularyLookupResult {
  input: string;
  canonicalTerm: string | null;
  meaning: string | null;
  relatedActions: string[];
  matchedBy: "canonical" | "synonym" | "none";
}

export interface PatternMatchResult {
  input: string;
  intent: string | null;
  matchedPattern: string | null;
  confidence: number;
}

export interface EntityLookupResult {
  input: string;
  entityType: string | null;
  matchedText: string | null;
  confidence: number;
}

interface NormalizedSynonymEntry {
  normalizedSynonym: string;
  canonicalTerm: string;
}

interface NormalizedEntityAlias {
  normalizedAlias: string;
  entityType: string;
  originalAlias: string;
}

interface KnowledgeIndexes {
  canonicalTerms: string[];
  synonymEntries: NormalizedSynonymEntry[];
  entityAliases: NormalizedEntityAlias[];
  patterns: Array<{
    intent: string;
    originalPattern: string;
    normalizedPattern: string;
  }>;
}

let cachedKnowledge: JsonKnowledgeData | null = null;
let cachedIndexes: KnowledgeIndexes | null = null;

const bundledKnowledgeFiles = {
  "vocabulary.json": require("../../data/vocabulary.json") as VocabularyData,
  "synonyms.json": require("../../data/synonyms.json") as SynonymsData,
  "patterns.json": require("../../data/patterns.json") as PatternsData,
  "entities.json": require("../../data/entities.json") as EntitiesData,
};

function loadJsonFile<K extends keyof typeof bundledKnowledgeFiles>(
  fileName: K,
): (typeof bundledKnowledgeFiles)[K] {
  return bundledKnowledgeFiles[fileName];
}

function validateKnowledge(
  knowledge: JsonKnowledgeData,
): void {
  if (
    !knowledge.vocabulary ||
    typeof knowledge.vocabulary !== "object"
  ) {
    throw new Error(
      "Invalid vocabulary.json: expected an object.",
    );
  }

  if (
    !knowledge.synonyms ||
    typeof knowledge.synonyms !== "object"
  ) {
    throw new Error(
      "Invalid synonyms.json: expected an object.",
    );
  }

  if (
    !knowledge.patterns ||
    typeof knowledge.patterns !== "object"
  ) {
    throw new Error(
      "Invalid patterns.json: expected an object.",
    );
  }

  if (
    !knowledge.entities ||
    typeof knowledge.entities !== "object"
  ) {
    throw new Error(
      "Invalid entities.json: expected an object.",
    );
  }
}

export function loadJsonKnowledge(): JsonKnowledgeData {
  if (cachedKnowledge) {
    return cachedKnowledge;
  }

  const knowledge: JsonKnowledgeData = {
    vocabulary: loadJsonFile("vocabulary.json"),
    synonyms: loadJsonFile("synonyms.json"),
    patterns: loadJsonFile("patterns.json"),
    entities: loadJsonFile("entities.json"),
  };

  validateKnowledge(knowledge);

  cachedKnowledge = knowledge;

  return cachedKnowledge;
}

export function resetJsonKnowledgeCache(): void {
  cachedKnowledge = null;
  cachedIndexes = null;
}

export function normalizeKnowledgeText(
  input: string,
): string {
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
function containsCompletePhrase(
  normalizedText: string,
  normalizedPhrase: string,
): boolean {
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
function buildKnowledgeIndexes(): KnowledgeIndexes {
  if (cachedIndexes) {
    return cachedIndexes;
  }

  const knowledge = loadJsonKnowledge();

  const canonicalTerms = Object.keys(
    knowledge.vocabulary,
  )
    .map(normalizeKnowledgeText)
    .filter(Boolean)
    .sort((first, second) => {
      return second.length - first.length;
    });

  const synonymEntries: NormalizedSynonymEntry[] =
    Object.entries(knowledge.synonyms)
      .map(([synonym, canonicalTerm]) => ({
        normalizedSynonym:
          normalizeKnowledgeText(synonym),
        canonicalTerm: normalizeKnowledgeText(
          canonicalTerm,
        ),
      }))
      .filter(
        (entry) =>
          entry.normalizedSynonym.length > 0 &&
          entry.canonicalTerm.length > 0,
      )
      .sort((first, second) => {
        return (
          second.normalizedSynonym.length -
          first.normalizedSynonym.length
        );
      });

  const entityAliases: NormalizedEntityAlias[] = [];

  for (const [entityType, aliases] of Object.entries(
    knowledge.entities,
  )) {
    for (const alias of aliases) {
      const normalizedAlias =
        normalizeKnowledgeText(alias);

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
    return (
      second.normalizedAlias.length -
      first.normalizedAlias.length
    );
  });

  const patterns: KnowledgeIndexes["patterns"] = [];

  for (const [intent, intentPatterns] of Object.entries(
    knowledge.patterns,
  )) {
    for (const pattern of intentPatterns) {
      const normalizedPattern =
        normalizeKnowledgeText(pattern);

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
    return (
      second.normalizedPattern.length -
      first.normalizedPattern.length
    );
  });

  cachedIndexes = {
    canonicalTerms,
    synonymEntries,
    entityAliases,
    patterns,
  };

  return cachedIndexes;
}

export function lookupVocabulary(
  input: string,
): VocabularyLookupResult {
  const knowledge = loadJsonKnowledge();
  const normalizedInput =
    normalizeKnowledgeText(input);

  if (!normalizedInput) {
    return {
      input,
      canonicalTerm: null,
      meaning: null,
      relatedActions: [],
      matchedBy: "none",
    };
  }

  const canonicalEntry =
    knowledge.vocabulary[normalizedInput];

  if (canonicalEntry) {
    return {
      input,
      canonicalTerm: normalizedInput,
      meaning: canonicalEntry.meaning,
      relatedActions:
        canonicalEntry.relatedActions ?? [],
      matchedBy: "canonical",
    };
  }

  const indexes = buildKnowledgeIndexes();

  const matchedSynonym =
    indexes.synonymEntries.find(
      (entry) =>
        entry.normalizedSynonym === normalizedInput,
    );

  if (!matchedSynonym) {
    return {
      input,
      canonicalTerm: null,
      meaning: null,
      relatedActions: [],
      matchedBy: "none",
    };
  }

  const vocabularyEntry =
    knowledge.vocabulary[
      matchedSynonym.canonicalTerm
    ];

  return {
    input,
    canonicalTerm: matchedSynonym.canonicalTerm,
    meaning: vocabularyEntry?.meaning ?? null,
    relatedActions:
      vocabularyEntry?.relatedActions ?? [],
    matchedBy: "synonym",
  };
}

export function findCanonicalTerms(
  input: string,
): string[] {
  const normalizedInput =
    normalizeKnowledgeText(input);

  if (!normalizedInput) {
    return [];
  }

  const indexes = buildKnowledgeIndexes();
  const matchedTerms = new Set<string>();

  for (const canonicalTerm of indexes.canonicalTerms) {
    if (
      containsCompletePhrase(
        normalizedInput,
        canonicalTerm,
      )
    ) {
      matchedTerms.add(canonicalTerm);
    }
  }

  for (const synonymEntry of indexes.synonymEntries) {
    if (
      containsCompletePhrase(
        normalizedInput,
        synonymEntry.normalizedSynonym,
      )
    ) {
      matchedTerms.add(
        synonymEntry.canonicalTerm,
      );
    }
  }

  return [...matchedTerms];
}

function calculatePatternConfidence(
  normalizedPattern: string,
): number {
  const tokenCount =
    normalizedPattern.split(" ").filter(Boolean)
      .length;

  const characterScore = Math.min(
    0.2,
    normalizedPattern.length / 100,
  );

  const tokenScore = Math.min(
    0.15,
    tokenCount * 0.04,
  );

  return Number(
    Math.min(
      0.98,
      0.6 + characterScore + tokenScore,
    ).toFixed(2),
  );
}

export function matchPattern(
  input: string,
): PatternMatchResult {
  const normalizedInput =
    normalizeKnowledgeText(input);

  if (!normalizedInput) {
    return {
      input,
      intent: null,
      matchedPattern: null,
      confidence: 0,
    };
  }

  const indexes = buildKnowledgeIndexes();

  const matchedPattern = indexes.patterns.find(
    (pattern) =>
      containsCompletePhrase(
        normalizedInput,
        pattern.normalizedPattern,
      ),
  );

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
    confidence: calculatePatternConfidence(
      matchedPattern.normalizedPattern,
    ),
  };
}

export function extractEntityFromKnowledge(
  input: string,
): EntityLookupResult {
  const normalizedInput =
    normalizeKnowledgeText(input);

  if (!normalizedInput) {
    return {
      input,
      entityType: null,
      matchedText: null,
      confidence: 0,
    };
  }

  const indexes = buildKnowledgeIndexes();

  const matchedEntity =
    indexes.entityAliases.find((entity) =>
      containsCompletePhrase(
        normalizedInput,
        entity.normalizedAlias,
      ),
    );

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