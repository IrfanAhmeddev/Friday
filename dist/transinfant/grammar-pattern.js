"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrammarPatternStore = void 0;
exports.induceGrammarPattern = induceGrammarPattern;
exports.supplyGrammarPattern = supplyGrammarPattern;
exports.analyzeUnlabeledPatternAmbiguity = analyzeUnlabeledPatternAmbiguity;
exports.interpretWithGrammarPattern = interpretWithGrammarPattern;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const memory_store_1 = require("./memory-store");
const ROLES = ["subject", "predicate", "object"];
const MAX_EXAMPLES = 64;
function normalize(value) {
    return value.normalize("NFKC").toLocaleLowerCase().trim();
}
function permutations(items) {
    const result = [];
    const visit = (prefix, rest) => {
        if (rest.length === 0) {
            result.push(prefix);
            return;
        }
        for (let index = 0; index < rest.length; index++) {
            visit([...prefix, rest[index]], [...rest.slice(0, index), ...rest.slice(index + 1)]);
        }
    };
    visit([], items);
    return result;
}
function canonicalExample(example) {
    return JSON.stringify({
        tokens: example.tokens.map(normalize),
        frame: {
            subject: normalize(example.frame.subject),
            predicate: normalize(example.frame.predicate),
            object: normalize(example.frame.object),
        },
    });
}
function distinctExamples(examples) {
    const seen = new Set();
    return examples.filter((example) => {
        const canonical = canonicalExample(example);
        if (seen.has(canonical))
            return false;
        seen.add(canonical);
        return true;
    });
}
function candidateMatches(roles, example) {
    return roles.every((role, index) => normalize(example.tokens[index]) === normalize(example.frame[role]));
}
function makeSnapshot(examples, version, source) {
    if (examples.length > MAX_EXAMPLES) {
        throw new Error(`Pattern evidence limit exceeded (${MAX_EXAMPLES}).`);
    }
    const uniqueExamples = distinctExamples(examples).sort((left, right) => left.id.localeCompare(right.id));
    if (uniqueExamples.some((example) => !example.id.trim() ||
        example.tokens.some((token) => !token.trim()) ||
        ROLES.some((role) => !example.frame[role].trim()))) {
        throw new Error("Pattern examples require an id, three tokens, and a complete frame.");
    }
    const candidates = permutations(ROLES).map((permutation) => {
        const support = uniqueExamples
            .filter((example) => candidateMatches(permutation, example))
            .map((example) => example.id);
        const contradictions = uniqueExamples
            .filter((example) => !candidateMatches(permutation, example))
            .map((example) => example.id);
        return {
            rolesByPosition: permutation,
            supportingEvidenceIds: support,
            contradictionEvidenceIds: contradictions,
            score: uniqueExamples.length === 0 ? 0 : support.length / uniqueExamples.length,
        };
    }).sort((left, right) => right.score - left.score ||
        left.rolesByPosition.join(",").localeCompare(right.rolesByPosition.join(",")));
    const best = candidates[0];
    const runnerUp = candidates[1];
    const enoughEvidence = uniqueExamples.length >= 2;
    const uniqueBest = best.score > (runnerUp?.score ?? 0);
    const confidence = best.score * Math.min(1, uniqueExamples.length / 2);
    const fingerprint = (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify({
        version,
        source,
        examples: uniqueExamples.map((example) => ({
            id: example.id,
            canonical: canonicalExample(example),
        })),
    }))
        .digest("hex")
        .slice(0, 16);
    const accepted = enoughEvidence &&
        uniqueBest &&
        best.score === 1 &&
        best.contradictionEvidenceIds.length === 0;
    return {
        schemaVersion: 1,
        id: `pattern-${version}-${fingerprint}`,
        version,
        status: accepted
            ? "accepted"
            : !enoughEvidence || !uniqueBest
                ? "ambiguous"
                : "rejected",
        source,
        pattern: accepted ? best.rolesByPosition : null,
        confidence,
        evidenceIds: uniqueExamples.map((example) => example.id),
        evidenceSources: uniqueExamples.map((example) => ({
            id: example.id,
            source: example.source ?? "weak-supervision",
        })),
        candidates,
        reason: accepted
            ? `Unique candidate supported by ${best.supportingEvidenceIds.length} distinct labeled examples.`
            : !enoughEvidence
                ? "At least two distinct labeled examples are required."
                : !uniqueBest
                    ? "Multiple candidate patterns remain equally supported."
                    : "The best candidate conflicts with at least one labeled example.",
        createdAt: new Date().toISOString(),
    };
}
function induceGrammarPattern(examples, version = 1) {
    return makeSnapshot(examples, version, "induced");
}
function supplyGrammarPattern(id, rolesByPosition, version = 1) {
    if (new Set(rolesByPosition).size !== 3 ||
        rolesByPosition.some((role) => !ROLES.includes(role))) {
        throw new Error("Supplied pattern must assign each role exactly once.");
    }
    return {
        schemaVersion: 1,
        id,
        version,
        status: "accepted",
        source: "supplied",
        pattern: [...rolesByPosition],
        confidence: 1,
        evidenceIds: [],
        evidenceSources: [],
        candidates: [],
        reason: "Pattern was directly supplied; this is a reference condition, not induction.",
        createdAt: new Date().toISOString(),
    };
}
function analyzeUnlabeledPatternAmbiguity(sentences) {
    if (sentences.length > MAX_EXAMPLES || sentences.some((sentence) => sentence.length !== 3 || sentence.some((token) => !token.trim()))) {
        throw new Error(`Unlabeled pattern input must contain at most ${MAX_EXAMPLES} three-token sentences.`);
    }
    return permutations(ROLES).map((permutation) => ({
        rolesByPosition: permutation,
        supportingEvidenceIds: [],
        contradictionEvidenceIds: [],
        score: sentences.length === 0 ? 0 : 1,
    }));
}
function validateSnapshot(value) {
    if (!value ||
        typeof value !== "object" ||
        value.schemaVersion !== 1 ||
        !Array.isArray(value.candidates) ||
        !Array.isArray(value.evidenceIds) ||
        !Array.isArray(value.evidenceSources)) {
        throw new Error("Invalid grammar-pattern store or unsupported schema version.");
    }
    return value;
}
class GrammarPatternStore {
    filePath;
    constructor(filePath) {
        this.filePath = node_path_1.default.resolve(filePath);
        const productionPath = node_path_1.default.resolve(memory_store_1.DEFAULT_KNOWLEDGE_STORE_PATH);
        const samePath = process.platform === "win32"
            ? this.filePath.toLocaleLowerCase() === productionPath.toLocaleLowerCase()
            : this.filePath === productionPath;
        if (samePath) {
            throw new Error("Grammar-pattern store cannot use FRIDAY's production memory path.");
        }
    }
    getFilePath() {
        return this.filePath;
    }
    async read() {
        let contents;
        try {
            contents = await (0, promises_1.readFile)(this.filePath, "utf8");
        }
        catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
                return null;
            }
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(contents);
        }
        catch (error) {
            throw new Error(`Could not parse grammar-pattern store: ${error instanceof Error ? error.message : String(error)}`);
        }
        return validateSnapshot(parsed);
    }
    async write(snapshot) {
        validateSnapshot(snapshot);
        const directory = node_path_1.default.dirname(this.filePath);
        await (0, promises_1.mkdir)(directory, { recursive: true });
        const temporaryPath = `${this.filePath}.${(0, node_crypto_1.randomUUID)()}.tmp`;
        await (0, promises_1.writeFile)(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
        await (0, promises_1.rename)(temporaryPath, this.filePath);
    }
    async reset() {
        try {
            await (0, promises_1.unlink)(this.filePath);
        }
        catch (error) {
            if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
                throw error;
            }
        }
    }
}
exports.GrammarPatternStore = GrammarPatternStore;
async function interpretWithGrammarPattern(text, store, conceptsByToken = {}, knownTokens) {
    const snapshot = await store.read();
    const tokens = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const base = {
        recognizedTokens: tokens,
        patternId: snapshot?.id ?? null,
        patternVersion: snapshot?.version ?? null,
        source: snapshot?.source ?? null,
        provenance: snapshot?.evidenceIds ?? [],
        confidence: snapshot?.confidence ?? null,
    };
    if (/\b(?:not|never|without|don't|doesn't|didn't|cannot|can't)\b/i.test(text)) {
        return {
            ...base,
            status: "unsupported",
            frame: null,
            reason: "Explicit negation prevented learned pattern interpretation.",
        };
    }
    if (!snapshot) {
        return { ...base, status: "ambiguous", frame: null, reason: "No stored pattern is available." };
    }
    if (tokens.length !== 3) {
        return {
            ...base,
            status: "unsupported",
            frame: null,
            reason: `Expected exactly three tokens; received ${tokens.length}.`,
        };
    }
    const normalizedKnownTokens = knownTokens?.map(normalize);
    const unknownToken = normalizedKnownTokens
        ? tokens.find((token) => !normalizedKnownTokens.includes(normalize(token)))
        : undefined;
    if (unknownToken) {
        return {
            ...base,
            status: "unknown",
            frame: null,
            reason: `Token "${unknownToken}" is not in the learned vocabulary.`,
        };
    }
    if (snapshot.status !== "accepted" || !snapshot.pattern) {
        return { ...base, status: "ambiguous", frame: null, reason: snapshot.reason };
    }
    const concepts = tokens.map((token) => conceptsByToken[normalize(token)] ?? token);
    const frame = { subject: "", predicate: "", object: "" };
    for (let index = 0; index < 3; index++) {
        frame[snapshot.pattern[index]] = concepts[index];
    }
    return {
        ...base,
        status: "supported",
        frame,
        reason: null,
    };
}
