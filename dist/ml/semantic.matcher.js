"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cosineSimilarity = cosineSimilarity;
exports.findSemanticMatches = findSemanticMatches;
const embedding_engine_1 = require("./embedding.engine");
function cosineSimilarity(a, b) {
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
    return dot / (Math.sqrt(magnitudeA) *
        Math.sqrt(magnitudeB));
}
async function findSemanticMatches(input, candidates) {
    const inputEmbedding = await (0, embedding_engine_1.createEmbedding)(input);
    const matches = [];
    for (const candidate of candidates) {
        const candidateEmbedding = await (0, embedding_engine_1.createEmbedding)(candidate);
        const similarity = cosineSimilarity(inputEmbedding, candidateEmbedding);
        matches.push({
            text: candidate,
            similarity: Number(similarity.toFixed(4)),
        });
    }
    return matches.sort((a, b) => b.similarity - a.similarity);
}
