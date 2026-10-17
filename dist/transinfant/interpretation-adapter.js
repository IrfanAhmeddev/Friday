"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpretWithLearnedKnowledge = interpretWithLearnedKnowledge;
exports.isTransInfantEnabled = isTransInfantEnabled;
const memory_store_1 = require("./memory-store");
const CORE_ACTIONS = new Set([
    "create",
    "open",
    "search",
    "show",
    "edit",
    "rename",
    "delete",
    "close",
]);
const CORE_OBJECTS = new Set([
    "document",
    "spreadsheet",
    "presentation",
    "note",
    "file",
    "folder",
    "application",
    "report",
    "project",
]);
function normalize(value) {
    return value.normalize("NFKC").toLocaleLowerCase().trim();
}
function findMatchingSymbols(snapshot, input) {
    const normalizedInput = ` ${normalize(input).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    return snapshot.symbols
        .filter((symbol) => {
        const normalizedSurface = normalize(symbol.surface)
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .trim();
        return normalizedSurface.length > 0 &&
            normalizedInput.includes(` ${normalizedSurface} `);
    })
        .sort((a, b) => b.surface.length - a.surface.length);
}
function acceptedRelations(snapshot, subject, predicate) {
    return snapshot.relationships.filter((relationship) => relationship.subject === subject &&
        relationship.predicate === predicate &&
        relationship.status === "accepted" &&
        relationship.source !== "inferred");
}
function conceptLabel(snapshot, id) {
    return snapshot.concepts.find((concept) => concept.id === id)?.label ?? null;
}
async function interpretWithLearnedKnowledge(input, enabled, store = memory_store_1.knowledgeStore, mode = "composition") {
    if (!enabled) {
        return {
            status: "disabled",
            candidate: null,
            reason: null,
            conceptCount: 0,
            relationshipCount: 0,
        };
    }
    let snapshot;
    try {
        snapshot = await store.read();
    }
    catch (error) {
        return {
            status: "degraded",
            candidate: null,
            reason: error instanceof Error ? error.message : String(error),
            conceptCount: 0,
            relationshipCount: 0,
        };
    }
    const matches = findMatchingSymbols(snapshot, input.text);
    if (matches.length === 0) {
        return {
            status: "no-match",
            candidate: null,
            reason: null,
            conceptCount: snapshot.concepts.length,
            relationshipCount: snapshot.relationships.length,
        };
    }
    if (/\b(?:not|never|without|don't|doesn't|didn't|cannot|can't)\b/i.test(input.text)) {
        return {
            status: "no-match",
            candidate: null,
            reason: "Explicit negation prevented learned interpretation.",
            conceptCount: snapshot.concepts.length,
            relationshipCount: snapshot.relationships.length,
        };
    }
    const candidates = [];
    for (const match of matches) {
        const actionRelations = [
            ...acceptedRelations(snapshot, match.conceptId, "equivalent-to"),
            ...acceptedRelations(snapshot, match.conceptId, "denotes"),
        ];
        for (const relation of actionRelations) {
            const actionLabel = conceptLabel(snapshot, relation.object);
            if (!actionLabel || !CORE_ACTIONS.has(normalize(actionLabel))) {
                continue;
            }
            if (input.explicitAction && input.baselineAction !== actionLabel) {
                continue;
            }
            const evidence = [
                `symbol "${match.surface}" matched concept ${match.conceptId}`,
                `accepted ${relation.predicate} relationship ${relation.id}`,
            ];
            candidates.push({
                action: actionLabel,
                object: null,
                confidence: Math.min(0.85, relation.confidence * 0.85),
                evidence,
                source: "transinfant",
            });
        }
        const objectRelations = [
            ...acceptedRelations(snapshot, match.conceptId, "is-a"),
            ...acceptedRelations(snapshot, match.conceptId, "denotes"),
        ];
        for (const relation of objectRelations) {
            const objectLabel = conceptLabel(snapshot, relation.object);
            if (!objectLabel || !CORE_OBJECTS.has(normalize(objectLabel))) {
                continue;
            }
            if (input.explicitObject && input.baselineObject !== objectLabel) {
                continue;
            }
            const evidence = [
                `symbol "${match.surface}" matched concept ${match.conceptId}`,
                `accepted ${relation.predicate} relationship ${relation.id}`,
            ];
            candidates.push({
                action: null,
                object: objectLabel,
                confidence: Math.min(0.85, relation.confidence * 0.85),
                evidence,
                source: "transinfant",
            });
        }
    }
    const supportedCandidates = mode === "retrieval" ? candidates.slice(0, 1) : candidates;
    const bestByField = new Map();
    for (const candidate of supportedCandidates) {
        const key = candidate.action ? "action" : "object";
        const current = bestByField.get(key);
        if (!current || candidate.confidence > current.confidence) {
            bestByField.set(key, candidate);
        }
        else if (current &&
            candidate.confidence === current.confidence &&
            candidate.action !== current.action) {
            return {
                status: "no-match",
                candidate: null,
                reason: "Ambiguous learned candidates were not applied.",
                conceptCount: snapshot.concepts.length,
                relationshipCount: snapshot.relationships.length,
            };
        }
    }
    const actionCandidate = bestByField.get("action");
    const objectCandidate = bestByField.get("object");
    const action = input.explicitAction
        ? input.baselineAction
        : actionCandidate?.action ?? input.baselineAction;
    const object = input.explicitObject
        ? input.baselineObject
        : objectCandidate?.object ?? input.baselineObject;
    if (action === input.baselineAction &&
        object === input.baselineObject) {
        return {
            status: "no-match",
            candidate: null,
            reason: supportedCandidates.length > 0
                ? "Learned evidence conflicted with explicit baseline evidence."
                : null,
            conceptCount: snapshot.concepts.length,
            relationshipCount: snapshot.relationships.length,
        };
    }
    const evidence = [
        ...(actionCandidate?.evidence ?? []),
        ...(objectCandidate?.evidence ?? []),
    ];
    const confidence = actionCandidate && objectCandidate
        ? Math.min(actionCandidate.confidence, objectCandidate.confidence)
        : actionCandidate?.confidence ?? objectCandidate?.confidence ?? 0;
    return {
        status: "applied",
        candidate: {
            action: action === "unknown" ? null : action,
            object: object === "unknown" ? null : object,
            confidence,
            evidence,
            source: "transinfant",
        },
        reason: null,
        conceptCount: snapshot.concepts.length,
        relationshipCount: snapshot.relationships.length,
    };
}
function isTransInfantEnabled() {
    return process.env.FRIDAY_TRANSINFANT === "true";
}
