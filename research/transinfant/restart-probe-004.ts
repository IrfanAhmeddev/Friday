import {
  GrammarPatternStore,
  interpretWithGrammarPattern,
} from "../../src/transinfant/grammar-pattern";

async function main(): Promise<void> {
  const [storePath, sentence, knownTokensJson] = process.argv.slice(2);
  if (!storePath || !sentence || !knownTokensJson) {
    throw new Error("Usage: restart-probe-004 <store> <sentence> <known-tokens-json>");
  }
  const store = new GrammarPatternStore(storePath);
  const knownTokens = JSON.parse(knownTokensJson) as string[];
  const result = await interpretWithGrammarPattern(sentence, store, {}, knownTokens);
  console.log(JSON.stringify(result));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
