"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.learnExperience = learnExperience;
exports.inspectKnowledge = inspectKnowledge;
exports.resetKnowledge = resetKnowledge;
exports.revertExperience = revertExperience;
const node_crypto_1 = require("node:crypto");
const memory_store_1 = require("./memory-store");
const FUNCTIONAL_RELATIONSHIPS = new Set([
    "equivalent-to",
    "denotes",
]);
function normalizeSymbol(value) {
    return value.normalize("NFKC").toLocaleLowerCase().trim();
}
function findConcept(snapshot, reference) {
    const exactId = snapshot.concepts.find((concept) => concept.id === reference);
    if (exactId) {
        return exactId;
    }
    const normalized = normalizeSymbol(reference);
    const symbol = snapshot.symbols.find((candidate) => candidate.normalized === normalized);
    return symbol
        ? snapshot.concepts.find((concept) => concept.id === symbol.conceptId)
        : undefined;
}
function buildEvent(experience, details, addedConceptIds, addedSymbolKeys, addedRelationshipIds, supersededRelationshipIds) {
    return {
        id: (0, node_crypto_1.randomUUID)(),
        timestamp: experience.timestamp ?? new Date().toISOString(),
        experienceId: experience.id,
        source: experience.source,
        outcome: details.length === 0
            ? "accepted"
            : addedRelationshipIds.length > 0 || addedConceptIds.length > 0
                ? "partial"
                : "rejected",
        details,
        addedConceptIds,
        addedSymbolKeys,
        addedRelationshipIds,
        supersededRelationshipIds,
    };
}
function validateExperience(experience) {
    if (!experience.id.trim() || !experience.source.trim()) {
        throw new Error("Learning experience requires a non-empty id and source.");
    }
    if (!Array.isArray(experience.entities) || experience.entities.length === 0) {
        throw new Error("Learning experience must provide at least one entity.");
    }
    if (!Array.isArray(experience.relationships)) {
        throw new Error("Learning experience relationships must be an array.");
    }
    const ids = new Set();
    for (const entity of experience.entities) {
        if (!entity.id.trim() || !entity.label.trim()) {
            throw new Error("Each learning entity requires a non-empty id and label.");
        }
        if (ids.has(entity.id)) {
            throw new Error(`Duplicate entity id in experience: ${entity.id}`);
        }
        ids.add(entity.id);
    }
    for (const relationship of experience.relationships) {
        if (!relationship.subject.trim() ||
            !relationship.predicate.trim() ||
            !relationship.object.trim()) {
            throw new Error("Relationships require subject, predicate, and object.");
        }
        if (relationship.confidence !== undefined &&
            (!Number.isFinite(relationship.confidence) ||
                relationship.confidence < 0 ||
                relationship.confidence > 1)) {
            throw new Error("Relationship confidence must be between 0 and 1.");
        }
    }
}
function insertEntity(snapshot, entity, timestamp, addedConceptIds, addedSymbolKeys, details) {
    const existingConcept = snapshot.concepts.find((concept) => concept.id === entity.id);
    const concept = existingConcept ?? {
        id: entity.id,
        label: entity.label.trim(),
        attributes: {},
        createdAt: timestamp,
        updatedAt: timestamp,
    };
    if (!existingConcept) {
        snapshot.concepts.push(concept);
        addedConceptIds.push(concept.id);
    }
    else if (normalizeSymbol(existingConcept.label) !== normalizeSymbol(entity.label)) {
        details.push(`Entity id ${entity.id} already refers to "${existingConcept.label}".`);
    }
    for (const [key, value] of Object.entries(entity.attributes ?? {})) {
        if (!(key in concept.attributes)) {
            concept.attributes[key] = value;
            concept.updatedAt = timestamp;
        }
        else if (concept.attributes[key] !== value) {
            details.push(`Conflicting attribute "${key}" for ${concept.label}; retained the existing value.`);
        }
    }
    const forms = [entity.label, ...(entity.aliases ?? [])]
        .map((surface) => surface.trim())
        .filter(Boolean);
    for (const surface of forms) {
        const normalized = normalizeSymbol(surface);
        const symbol = snapshot.symbols.find((candidate) => candidate.normalized === normalized);
        if (symbol && symbol.conceptId !== entity.id) {
            details.push(`Symbol "${surface}" already refers to another concept; alias not reassigned.`);
            continue;
        }
        if (!symbol) {
            const record = {
                normalized,
                conceptId: entity.id,
                surface,
            };
            snapshot.symbols.push(record);
            addedSymbolKeys.push(normalized);
        }
    }
}
async function learnExperience(experience, store = memory_store_1.knowledgeStore) {
    validateExperience(experience);
    const acceptedRelationshipIds = [];
    const candidateRelationshipIds = [];
    const rejectedRelationshipIds = [];
    const details = [];
    const snapshot = await store.update((current) => {
        if (current.events.some((event) => event.experienceId === experience.id)) {
            throw new Error(`Experience id already exists: ${experience.id}`);
        }
        const timestamp = experience.timestamp ?? new Date().toISOString();
        const addedConceptIds = [];
        const addedSymbolKeys = [];
        const addedRelationshipIds = [];
        const supersededRelationshipIds = [];
        for (const entity of experience.entities) {
            insertEntity(current, entity, timestamp, addedConceptIds, addedSymbolKeys, details);
        }
        for (const relationship of experience.relationships) {
            const subject = findConcept(current, relationship.subject);
            const object = findConcept(current, relationship.object);
            if (!subject || !object) {
                details.push(`Relationship refers to an unknown concept (${relationship.subject} ${relationship.predicate} ${relationship.object}).`);
                rejectedRelationshipIds.push((0, node_crypto_1.randomUUID)());
                continue;
            }
            const duplicate = current.relationships.find((existing) => existing.subject === subject.id &&
                existing.predicate === relationship.predicate &&
                existing.object === object.id &&
                existing.status === "accepted");
            if (duplicate) {
                details.push(`Duplicate relationship already stored: ${duplicate.id}.`);
                acceptedRelationshipIds.push(duplicate.id);
                continue;
            }
            const conflicting = FUNCTIONAL_RELATIONSHIPS.has(relationship.predicate)
                ? current.relationships.filter((existing) => existing.subject === subject.id &&
                    existing.predicate === relationship.predicate &&
                    existing.object !== object.id &&
                    existing.status === "accepted")
                : [];
            if (conflicting.length > 0 && relationship.source !== "feedback") {
                details.push(`Contradictory ${relationship.predicate} relationship for ${subject.label}; existing knowledge retained.`);
                rejectedRelationshipIds.push((0, node_crypto_1.randomUUID)());
                continue;
            }
            for (const previous of conflicting) {
                previous.status = "superseded";
                supersededRelationshipIds.push(previous.id);
            }
            const id = (0, node_crypto_1.randomUUID)();
            const record = {
                ...relationship,
                subject: subject.id,
                object: object.id,
                id,
                experienceId: experience.id,
                timestamp,
                confidence: relationship.confidence ?? 1,
                status: relationship.source === "inferred" ? "candidate" : "accepted",
            };
            current.relationships.push(record);
            addedRelationshipIds.push(id);
            if (record.status === "accepted") {
                acceptedRelationshipIds.push(id);
            }
            else {
                candidateRelationshipIds.push(id);
            }
        }
        current.events.push(buildEvent(experience, details, addedConceptIds, addedSymbolKeys, addedRelationshipIds, supersededRelationshipIds));
        return current;
    });
    return {
        accepted: acceptedRelationshipIds.length > 0 ||
            candidateRelationshipIds.length > 0 ||
            snapshot.events.some((event) => event.experienceId === experience.id &&
                event.addedConceptIds.length > 0),
        experienceId: experience.id,
        acceptedRelationshipIds,
        candidateRelationshipIds,
        rejectedRelationshipIds,
        details,
    };
}
async function inspectKnowledge(store = memory_store_1.knowledgeStore) {
    return store.read();
}
async function resetKnowledge(store = memory_store_1.knowledgeStore) {
    await store.reset();
}
async function revertExperience(experienceId, store = memory_store_1.knowledgeStore) {
    let reverted = false;
    await store.update((snapshot) => {
        const event = [...snapshot.events]
            .reverse()
            .find((candidate) => candidate.experienceId === experienceId &&
            candidate.outcome !== "reverted");
        if (!event) {
            return snapshot;
        }
        snapshot.relationships = snapshot.relationships.filter((relationship) => !event.addedRelationshipIds.includes(relationship.id));
        for (const relationship of snapshot.relationships) {
            if (event.supersededRelationshipIds.includes(relationship.id)) {
                relationship.status = "accepted";
            }
        }
        const conceptIdsInUse = new Set(snapshot.relationships.flatMap((relationship) => [
            relationship.subject,
            relationship.object,
        ]));
        const removableConceptIds = event.addedConceptIds.filter((id) => !conceptIdsInUse.has(id));
        snapshot.concepts = snapshot.concepts.filter((concept) => !removableConceptIds.includes(concept.id));
        snapshot.symbols = snapshot.symbols.filter((symbol) => !event.addedSymbolKeys.includes(symbol.normalized) ||
            !removableConceptIds.includes(symbol.conceptId));
        event.outcome = "reverted";
        event.details.push("Learning event reverted by explicit request.");
        snapshot.events.push({
            id: (0, node_crypto_1.randomUUID)(),
            timestamp: new Date().toISOString(),
            experienceId: `revert:${experienceId}`,
            source: "revert",
            outcome: "reverted",
            details: [`Reverted experience ${experienceId}.`],
            addedConceptIds: [],
            addedSymbolKeys: [],
            addedRelationshipIds: [],
            supersededRelationshipIds: [],
        });
        reverted = true;
        return snapshot;
    });
    return reverted;
}
