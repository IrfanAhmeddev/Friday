"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIntent = detectIntent;
const fuse_js_1 = __importDefault(require("fuse.js"));
const intents_1 = require("../knowledge/intents");
const examples = intents_1.INTENTS.flatMap((intent) => intent.examples.map((example) => ({
    intent: intent.name,
    example,
    keywords: intent.keywords
})));
const fuse = new fuse_js_1.default(examples, {
    keys: ["example"],
    includeScore: true,
    threshold: 0.6,
    ignoreLocation: true
});
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^\w]/g, ""))
        .filter(Boolean);
}
function lexicalSimilarity(input, example) {
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
function keywordScore(input, keywords) {
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
function detectIntent(text) {
    const normalized = text.toLowerCase().trim();
    if (!normalized) {
        return {
            name: "unknown",
            confidence: 0
        };
    }
    const results = fuse.search(normalized);
    const scores = new Map();
    for (const result of results) {
        const candidate = result.item;
        const fuzzyScore = result.score === undefined
            ? 0
            : 1 - result.score;
        const lexicalScore = lexicalSimilarity(normalized, candidate.example);
        const keywordsScore = keywordScore(normalized, candidate.keywords);
        /*
         * Weighted score:
         *
         * 45% fuzzy similarity
         * 35% lexical similarity
         * 20% keyword evidence
         */
        const score = fuzzyScore * 0.45 +
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
        confidence: Number(Math.min(bestScore, 0.99).toFixed(3))
    };
}
