"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teachVocabulary = teachVocabulary;
exports.queryVocabulary = queryVocabulary;
exports.composeWithVocabulary = composeWithVocabulary;
exports.exportVocabularySnapshot = exportVocabularySnapshot;
exports.inspectVocabulary = inspectVocabulary;
exports.resetVocabularyMemory = resetVocabularyMemory;
const node_path_1 = __importDefault(require("node:path"));
const memory_store_1 = require("./memory-store");
const learner_1 = require("./learner");
function assertIsolatedStore(store) {
    const storePath = node_path_1.default.resolve(store.getFilePath());
    const productionPath = node_path_1.default.resolve(memory_store_1.DEFAULT_KNOWLEDGE_STORE_PATH);
    const pathsMatch = process.platform === "win32"
        ? storePath.toLocaleLowerCase() === productionPath.toLocaleLowerCase()
        : storePath === productionPath;
    if (pathsMatch) {
        throw new Error("Vocabulary learning requires an isolated store; the production TransInfant store is protected.");
    }
}
function normalize(value) {
    return value.normalize("NFKC").toLocaleLowerCase().trim();
}
function matchingInputConceptIds(snapshot, input, kind) {
    const normalized = normalize(input);
    return [...new Set(snapshot.symbols
            .filter((symbol) => symbol.normalized === normalized)
            .filter((symbol) => snapshot.concepts.some((concept) => concept.id === symbol.conceptId &&
            concept.attributes.vocabularyKind === kind))
            .map((symbol) => symbol.conceptId))];
}
function provenanceFor(snapshot, relationships) {
    return relationships.map((relationship) => {
        const event = snapshot.events.find((item) => item.experienceId === relationship.experienceId);
        const { id, experienceId, source, confidence, status, timestamp } = relationship;
        return {
            relationshipId: id,
            experienceId,
            source: event?.source ?? source,
            relationshipSource: relationship.source,
            confidence,
            status,
            timestamp,
        };
    });
}
function querySnapshot(snapshot, kind, input) {
    const inputConceptIds = matchingInputConceptIds(snapshot, input, kind);
    const relations = snapshot.relationships.filter((relationship) => inputConceptIds.includes(relationship.subject) &&
        relationship.predicate === "denotes");
    const accepted = relations.filter((relationship) => relationship.status === "accepted");
    const candidates = relations.filter((relationship) => relationship.status === "candidate");
    const selected = accepted.length > 0 ? accepted : candidates;
    const conceptIds = [...new Set(selected.map((item) => item.object))];
    const status = inputConceptIds.length > 1 ||
        accepted.length > 1 ||
        conceptIds.length > 1
        ? "ambiguous"
        : accepted.length === 1
            ? "supported"
            : candidates.length > 0 && conceptIds.length === 1
                ? "uncertain"
                : "unknown";
    const selectedConcept = status === "supported"
        ? snapshot.concepts.find((concept) => concept.id === conceptIds[0])
        : null;
    const normalizedInput = normalize(input);
    const selectedRelationships = selected;
    const relationIds = new Set(selectedRelationships.map((item) => item.id));
    const learningEvents = snapshot.events.filter((event) => event.addedRelationshipIds.some((id) => relationIds.has(id)) ||
        event.addedSymbolKeys.some((key) => snapshot.symbols.some((symbol) => symbol.normalized === key &&
            symbol.conceptId &&
            inputConceptIds.includes(symbol.conceptId) &&
            normalizedInput === symbol.normalized)));
    return {
        kind,
        input,
        recognized: inputConceptIds.length > 0,
        inputEntityIds: inputConceptIds,
        status,
        concept: selectedConcept
            ? {
                id: selectedConcept.id,
                label: selectedConcept.label,
                semanticRole: selectedConcept.attributes.semanticRole ?? null,
                definition: selectedConcept.attributes.definition ?? null,
            }
            : null,
        candidateConceptIds: conceptIds,
        confidence: selectedRelationships.length === 0
            ? null
            : Math.max(...selectedRelationships.map((item) => item.confidence)),
        provenance: provenanceFor(snapshot, selectedRelationships),
        learningEvents,
    };
}
async function teachVocabulary(teaching, store) {
    assertIsolatedStore(store);
    if (!teaching.input.surface.trim() || !teaching.concept.label.trim()) {
        throw new Error("Vocabulary teaching requires a non-empty input and concept label.");
    }
    if (!Number.isFinite(teaching.confidence) ||
        teaching.confidence < 0 ||
        teaching.confidence > 1) {
        throw new Error("Vocabulary confidence must be between 0 and 1.");
    }
    const inputAttributes = {
        vocabularyKind: teaching.input.kind,
        semanticRole: teaching.concept.semanticRole,
    };
    if (teaching.exampleUsage) {
        inputAttributes.exampleUsage = teaching.exampleUsage;
    }
    const conceptAttributes = {
        vocabularyKind: "meaning",
        semanticRole: teaching.concept.semanticRole,
    };
    if (teaching.concept.definition) {
        conceptAttributes.definition = teaching.concept.definition;
    }
    const experience = {
        id: teaching.id,
        source: teaching.source,
        timestamp: teaching.timestamp,
        entities: [
            {
                id: teaching.input.id,
                label: teaching.input.surface,
                aliases: teaching.input.aliases,
                attributes: inputAttributes,
            },
            {
                id: teaching.concept.id,
                label: teaching.concept.label,
                attributes: conceptAttributes,
            },
        ],
        relationships: [
            {
                subject: teaching.input.id,
                predicate: "denotes",
                object: teaching.concept.id,
                source: teaching.relationshipSource,
                confidence: teaching.confidence,
            },
        ],
    };
    return (0, learner_1.learnExperience)(experience, store);
}
async function queryVocabulary(kind, input, store) {
    assertIsolatedStore(store);
    if (!input.trim()) {
        throw new Error("Vocabulary query requires a non-empty input.");
    }
    return querySnapshot(await (0, learner_1.inspectKnowledge)(store), kind, input);
}
async function composeWithVocabulary(text, rule, store, enabled = true) {
    assertIsolatedStore(store);
    if (!enabled) {
        return {
            status: "disabled",
            ruleId: null,
            frame: null,
            confidence: null,
            evidence: [],
            reason: "Composition is disabled for this condition.",
        };
    }
    if (!Number.isInteger(rule.tokenCount) ||
        rule.tokenCount < 1 ||
        rule.roles.length !== rule.tokenCount ||
        rule.outputSlots.length !== rule.tokenCount ||
        new Set(rule.outputSlots).size !== 3) {
        throw new Error(`Invalid supplied composition rule: ${rule.id}.`);
    }
    const tokens = text
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? [];
    if (tokens.length !== rule.tokenCount) {
        return {
            status: "unsupported",
            ruleId: rule.id,
            frame: null,
            confidence: null,
            evidence: [],
            reason: "Input does not match the supplied rule's token count.",
        };
    }
    const snapshot = await (0, learner_1.inspectKnowledge)(store);
    const results = tokens.map((token) => querySnapshot(snapshot, "word", token));
    const uncertain = results.find((result) => result.status !== "supported");
    if (uncertain) {
        return {
            status: uncertain.status,
            ruleId: rule.id,
            frame: null,
            confidence: null,
            evidence: results.flatMap((result) => result.provenance),
            reason: `Word "${uncertain.input}" is ${uncertain.status}.`,
        };
    }
    for (let index = 0; index < results.length; index++) {
        if (results[index].concept?.semanticRole !== rule.roles[index]) {
            return {
                status: "unsupported",
                ruleId: rule.id,
                frame: null,
                confidence: null,
                evidence: results.flatMap((result) => result.provenance),
                reason: `Word "${tokens[index]}" does not satisfy supplied role "${rule.roles[index]}".`,
            };
        }
    }
    const frame = {
        subject: "",
        predicate: "",
        object: "",
    };
    for (let index = 0; index < results.length; index++) {
        const slot = rule.outputSlots[index];
        if (slot in frame) {
            frame[slot] = results[index].concept.id;
        }
    }
    if (Object.values(frame).some((value) => value.length === 0)) {
        throw new Error(`Supplied rule ${rule.id} did not fill all output slots.`);
    }
    const confidences = results.map((result) => result.confidence ?? 0);
    return {
        status: "supported",
        ruleId: rule.id,
        frame,
        confidence: Math.min(...confidences),
        evidence: results.flatMap((result) => result.provenance),
        reason: null,
    };
}
async function exportVocabularySnapshot(store) {
    assertIsolatedStore(store);
    return `${JSON.stringify(await (0, learner_1.inspectKnowledge)(store), null, 2)}\n`;
}
async function inspectVocabulary(store) {
    assertIsolatedStore(store);
    return (0, learner_1.inspectKnowledge)(store);
}
async function resetVocabularyMemory(store) {
    assertIsolatedStore(store);
    await (0, learner_1.resetKnowledge)(store);
}
