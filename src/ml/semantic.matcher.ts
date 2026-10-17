import { createEmbedding } from "./embedding.engine";

export interface SemanticMatch {
  text: string;
  similarity: number;
}

export function cosineSimilarity(
  a: number[],
  b: number[],
): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  if (a.length !== b.length) {
    throw new Error("Embedding dimensions do not match.");
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dot / (
    Math.sqrt(magnitudeA) *
    Math.sqrt(magnitudeB)
  );
}

export async function findSemanticMatches(
  input: string,
  candidates: string[],
): Promise<SemanticMatch[]> {
  const inputEmbedding = await createEmbedding(input);

  const matches: SemanticMatch[] = [];

  for (const candidate of candidates) {
    const candidateEmbedding = await createEmbedding(candidate);

    const similarity = cosineSimilarity(
      inputEmbedding,
      candidateEmbedding,
    );

    matches.push({
      text: candidate,
      similarity: Number(similarity.toFixed(4)),
    });
  }

  return matches.sort(
    (a, b) => b.similarity - a.similarity,
  );
}