import { KnowledgeStore } from "../../src/transinfant/memory-store";
import { queryVocabulary } from "../../src/transinfant/vocabulary-learning";
import {
  GrammarPatternStore,
  interpretWithGrammarPattern,
} from "../../src/transinfant/grammar-pattern";

async function main(): Promise<void> {
  const [vocabularyPath, patternPath, ...sentences] = process.argv.slice(2);
  if (!vocabularyPath || !patternPath || sentences.length === 0) {
    throw new Error("Usage: restart-probe-005 <vocabulary-store> <pattern-store> <sentence...>");
  }
  const vocabularyStore = new KnowledgeStore(vocabularyPath);
  const patternStore = new GrammarPatternStore(patternPath);
  const interpretations = [];
  for (const sentence of sentences) {
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
    interpretations.push(
      await interpretWithGrammarPattern(sentence, patternStore, conceptsByToken, knownTokens),
    );
  }
  const knowledge = await vocabularyStore.read();
  console.log(JSON.stringify({
    interpretations,
    conceptCount: knowledge.concepts.length,
    relationshipCount: knowledge.relationships.length,
    eventCount: knowledge.events.length,
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
