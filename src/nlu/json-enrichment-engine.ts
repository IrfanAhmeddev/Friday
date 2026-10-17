import {
  extractEntityFromKnowledge,
  findCanonicalTerms,
  lookupVocabulary,
  matchPattern,
  type EntityLookupResult,
  type PatternMatchResult,
  type VocabularyLookupResult
} from "../knowledge/json-knowledge-engine";

export interface JsonEnrichmentResult {
  input: string;

  canonicalTerms: string[];

  vocabularyMatches: VocabularyLookupResult[];

  patternMatch: PatternMatchResult;

  entity: EntityLookupResult;

  relatedActions: string[];

  hasActionKnowledge: boolean;

  hasEntityKnowledge: boolean;
}

export function enrichWithJsonKnowledge(
  input: string
): JsonEnrichmentResult {
  const canonicalTerms = findCanonicalTerms(input);

  const vocabularyMatches = canonicalTerms
    .map((term) => lookupVocabulary(term))
    .filter((result) => result.canonicalTerm !== null);

  const patternMatch = matchPattern(input);
  const entity = extractEntityFromKnowledge(input);

  const relatedActions = [
    ...new Set(
      vocabularyMatches.flatMap((result) => result.relatedActions)
    )
  ];

  if (patternMatch.intent) {
    relatedActions.push(patternMatch.intent);
  }

  return {
    input,
    canonicalTerms,
    vocabularyMatches,
    patternMatch,
    entity,
    relatedActions: [...new Set(relatedActions)],
    hasActionKnowledge: relatedActions.length > 0,
    hasEntityKnowledge: entity.entityType !== null
  };
}