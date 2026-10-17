import Fuse from "fuse.js";
import { INTENTS } from "../knowledge/intents";
import { IntentResult } from "../types/nlu";

interface IntentExample {
  intent: string;
  example: string;
  keywords: string[];
}

const examples: IntentExample[] = INTENTS.flatMap((intent) =>
  intent.examples.map((example) => ({
    intent: intent.name,
    example,
    keywords: intent.keywords
  }))
);

const fuse = new Fuse(examples, {
  keys: ["example"],
  includeScore: true,
  threshold: 0.6,
  ignoreLocation: true
});

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\w]/g, ""))
    .filter(Boolean);
}

function lexicalSimilarity(
  input: string,
  example: string
): number {
  const inputWords = new Set(tokenize(input));
  const exampleWords = new Set(tokenize(example));

  if (inputWords.size === 0 || exampleWords.size === 0) {
    return 0;
  }

  let matches = 0;

  for (const word of inputWords) {
    if (exampleWords.has(word)) {
      matches++;
    }
  }

  const union = new Set([
    ...inputWords,
    ...exampleWords
  ]);

  return matches / union.size;
}

function keywordScore(
  input: string,
  keywords: string[]
): number {
  const words = new Set(tokenize(input));

  if (keywords.length === 0) {
    return 0;
  }

  let matches = 0;

  for (const keyword of keywords) {
    if (words.has(keyword.toLowerCase())) {
      matches++;
    }
  }

  return matches / keywords.length;
}

export function detectIntent(text: string): IntentResult {
  const normalized = text.toLowerCase().trim();

  if (!normalized) {
    return {
      name: "unknown",
      confidence: 0
    };
  }

  const results = fuse.search(normalized);

  const scores = new Map<string, number>();

  for (const result of results) {
    const candidate = result.item;

    const fuzzyScore =
      result.score === undefined
        ? 0
        : 1 - result.score;

    const lexicalScore = lexicalSimilarity(
      normalized,
      candidate.example
    );

    const keywordsScore = keywordScore(
      normalized,
      candidate.keywords
    );

    /*
     * Weighted score:
     *
     * 45% fuzzy similarity
     * 35% lexical similarity
     * 20% keyword evidence
     */
    const score =
      fuzzyScore * 0.45 +
      lexicalScore * 0.35 +
      keywordsScore * 0.20;

    const existing = scores.get(candidate.intent) ?? 0;

    if (score > existing) {
      scores.set(candidate.intent, score);
    }
  }

  let bestIntent = "unknown";
  let bestScore = 0;

  for (const [intent, score] of scores.entries()) {
    if (score > bestScore) {
      bestIntent = intent;
      bestScore = score;
    }
  }

  /*
   * Prevent weak matches from becoming valid intents.
   */
  if (bestScore < 0.30) {
    return {
      name: "unknown",
      confidence: Number(bestScore.toFixed(3))
    };
  }

  return {
    name: bestIntent,
    confidence: Number(
      Math.min(bestScore, 0.99).toFixed(3)
    )
  };
}