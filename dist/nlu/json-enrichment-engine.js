"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichWithJsonKnowledge = enrichWithJsonKnowledge;
const json_knowledge_engine_1 = require("../knowledge/json-knowledge-engine");
function enrichWithJsonKnowledge(input) {
    const canonicalTerms = (0, json_knowledge_engine_1.findCanonicalTerms)(input);
    const vocabularyMatches = canonicalTerms
        .map((term) => (0, json_knowledge_engine_1.lookupVocabulary)(term))
        .filter((result) => result.canonicalTerm !== null);
    const patternMatch = (0, json_knowledge_engine_1.matchPattern)(input);
    const entity = (0, json_knowledge_engine_1.extractEntityFromKnowledge)(input);
    const relatedActions = [
        ...new Set(vocabularyMatches.flatMap((result) => result.relatedActions))
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
