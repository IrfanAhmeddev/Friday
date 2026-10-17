import { KnowledgeStore } from "../../src/transinfant/memory-store";
import {
  composeWithVocabulary,
  queryVocabulary,
} from "../../src/transinfant/vocabulary-learning";

const rule = {
  id: "supplied-svo-v1",
  tokenCount: 3,
  roles: ["entity", "predicate", "entity"],
  outputSlots: ["subject", "predicate", "object"] as const,
};

async function main(): Promise<void> {
  const [storePath] = process.argv.slice(2);
  if (!storePath) {
    throw new Error("Usage: restart-probe-003.ts <store-path>");
  }
  const store = new KnowledgeStore(storePath);
  const [word, symbol, composition] = await Promise.all([
    queryVocabulary("word", "kitty", store),
    queryVocabulary("symbol", "B", store),
    composeWithVocabulary("dog see cat", rule, store),
  ]);
  process.stdout.write(`${JSON.stringify({ word, symbol, composition })}\n`);
}

main().catch((error: unknown) => {
  console.error("TIDA-003 process-restart probe failed:", error);
  process.exitCode = 1;
});
