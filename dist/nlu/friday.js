"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.understand = understand;
const normalizer_1 = require("./normalizer");
const wink_engine_1 = require("./wink-engine");
const entity_engine_1 = require("./entity-engine");
const conversation_semantic_engine_1 = require("./conversation-semantic-engine");
const conversation_entity_engine_1 = require("./conversation-entity-engine");
const context_engine_1 = require("./context-engine");
const reference_engine_1 = require("./reference-engine");
const hybrid_intent_engine_1 = require("./hybrid-intent-engine");
const action_concept_engine_1 = require("./action-concept-engine");
const dialogue_manager_1 = require("./dialogue-manager");
const interpretation_adapter_1 = require("../transinfant/interpretation-adapter");
const memory_store_1 = require("../transinfant/memory-store");
const grammar_pattern_1 = require("../transinfant/grammar-pattern");
const learner_1 = require("../transinfant/learner");
const error_details_1 = require("../error-details");
function mapHybridAction(action) {
    const supportedActions = [
        "create",
        "open",
        "search",
        "show",
        "delete",
        "remove",
        "rename",
        "edit",
        "close",
        "unknown",
    ];
    if (supportedActions.includes(action)) {
        return action;
    }
    return "unknown";
}
function mapIntentAction(intent) {
    switch (intent) {
        case "workspace.create":
            return "create";
        case "workspace.open":
            return "open";
        case "workspace.search":
            return "search";
        case "workspace.show":
            return "show";
        case "workspace.rename":
            return "rename";
        case "workspace.delete":
            return "delete";
        case "workspace.close":
            return "close";
        case "workspace.edit":
            return "edit";
        default:
            return "unknown";
    }
}
function mapSemanticActionToIntent(action) {
    switch (action) {
        case "create":
            return "workspace.create";
        case "open":
            return "workspace.open";
        case "search":
            return "workspace.search";
        case "show":
            return "workspace.show";
        case "rename":
            return "workspace.rename";
        case "delete":
        case "remove":
            return "workspace.delete";
        case "close":
            return "workspace.close";
        case "edit":
            return "workspace.edit";
        default:
            return "unknown";
    }
}
function mapHybridObject(object) {
    const supportedObjects = [
        "document",
        "spreadsheet",
        "presentation",
        "note",
        "file",
        "folder",
        "application",
        "report",
        "project",
        "unknown",
    ];
    if (supportedObjects.includes(object)) {
        return object;
    }
    return "unknown";
}
function createSemanticFromHybrid(action, object, confidence, matchedWords) {
    return {
        action: mapHybridAction(action),
        object: mapHybridObject(object),
        confidence,
        matchedWords,
    };
}
function findEntity(entities, type) {
    return entities.find((entity) => entity.type === type);
}
function resolveExplicitWorkspaceObject(entities) {
    const workspaceEntity = findEntity(entities, "workspace_object");
    if (!workspaceEntity) {
        return null;
    }
    const object = mapHybridObject(workspaceEntity.value);
    return object !== "unknown"
        ? object
        : null;
}
function resolveSemanticObject(hybridObject, entities) {
    const explicitObject = resolveExplicitWorkspaceObject(entities);
    /*
     * Explicit workspace entities have priority.
     *
     * Example:
     * "rename this file to final report"
     *
     * The word "report" belongs to the new name.
     * It must not override the explicit object "file".
     */
    if (explicitObject) {
        return explicitObject;
    }
    return mapHybridObject(hybridObject);
}
function extractRenameTarget(text) {
    const renameMatch = text.match(/\b(?:rename|name)\b[\s\S]*?\b(?:to|as)\b\s+(.+?)\s*$/i);
    if (!renameMatch) {
        return undefined;
    }
    const newName = renameMatch[1]
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2")
        .replace(/[?.!,]+$/g, "")
        .trim();
    if (!newName) {
        return undefined;
    }
    return {
        type: "new_name",
        value: newName,
        confidence: 0.95,
    };
}
async function interpretWithStoredPattern(text, patternStore, vocabularyStore) {
    const tokens = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    try {
        const snapshot = await (0, learner_1.inspectKnowledge)(vocabularyStore);
        const conceptsByToken = {};
        const knownTokens = [];
        const vocabularyProvenance = [];
        for (const token of tokens) {
            const inputIds = snapshot.symbols
                .filter((symbol) => symbol.normalized === token)
                .filter((symbol) => snapshot.concepts.some((concept) => concept.id === symbol.conceptId &&
                concept.attributes.vocabularyKind === "word"))
                .map((symbol) => symbol.conceptId);
            const relations = snapshot.relationships.filter((relationship) => inputIds.includes(relationship.subject) &&
                relationship.predicate === "denotes" &&
                relationship.status === "accepted");
            const meanings = [...new Set(relations.map((relationship) => relationship.object))];
            if (inputIds.length === 1 && meanings.length === 1 && relations.length === 1) {
                conceptsByToken[token] = meanings[0];
                knownTokens.push(token);
                const relation = relations[0];
                vocabularyProvenance.push({
                    token,
                    relationshipId: relation.id,
                    experienceId: relation.experienceId,
                    source: relation.source,
                    confidence: relation.confidence,
                });
            }
        }
        const result = await (0, grammar_pattern_1.interpretWithGrammarPattern)(text, patternStore, conceptsByToken, knownTokens);
        return {
            ...result,
            recognizedConcepts: knownTokens.map((token) => conceptsByToken[token]),
            vocabularyProvenance,
        };
    }
    catch (error) {
        console.error(JSON.stringify({
            level: "error",
            event: "transinfant_grammar_interpretation_failed",
            error: (0, error_details_1.errorDetails)(error),
        }));
        return {
            status: "degraded",
            frame: null,
            recognizedTokens: tokens,
            patternId: null,
            patternVersion: null,
            source: null,
            provenance: [],
            confidence: null,
            reason: "TransInfant grammar interpretation is unavailable.",
            recognizedConcepts: [],
            vocabularyProvenance: [],
        };
    }
}
async function understand(text, sessionId = "default", options = {}) {
    const normalized = (0, normalizer_1.normalizeText)(text);
    const linguistic = (0, wink_engine_1.analyzeText)(normalized);
    const extractedEntities = (0, entity_engine_1.extractEntities)(normalized, linguistic);
    const conversationalEntities = (0, conversation_entity_engine_1.extractConversationalEntities)(normalized);
    const session = (0, context_engine_1.getOrCreateSession)(sessionId);
    const previousTurn = (0, context_engine_1.getLastMeaningfulTurn)(sessionId);
    const hybridResult = await (0, hybrid_intent_engine_1.understandIntent)(normalized, options.embeddingProvider);
    const conversationalSemantic = (0, conversation_semantic_engine_1.detectConversationalSemantic)(normalized, previousTurn?.semantic, previousTurn?.entities ?? []);
    const allEntities = [
        ...extractedEntities,
        ...conversationalEntities,
    ];
    const renameTarget = extractRenameTarget(normalized);
    if (renameTarget &&
        !findEntity(allEntities, "new_name")) {
        allEntities.push(renameTarget);
    }
    const semanticObject = resolveSemanticObject(hybridResult.workspaceObject, allEntities);
    const predictedAction = hybridResult.actionConcept !== "unknown"
        ? mapHybridAction(hybridResult.actionConcept)
        : hybridResult.confidence >= 0.7
            ? mapIntentAction(hybridResult.intent)
            : "unknown";
    let semantic;
    if (predictedAction !== "unknown" &&
        semanticObject !== "unknown") {
        semantic = createSemanticFromHybrid(predictedAction, semanticObject, hybridResult.confidence, [
            predictedAction,
            semanticObject,
        ]);
    }
    else if (conversationalSemantic.action !== "unknown") {
        semantic = {
            action: conversationalSemantic.action,
            object: conversationalSemantic.object,
            confidence: conversationalSemantic.confidence,
            matchedWords: conversationalSemantic.matchedWords,
        };
    }
    else {
        semantic = {
            action: predictedAction,
            object: semanticObject,
            confidence: hybridResult.confidence,
            matchedWords: [],
        };
    }
    if (hybridResult.ambiguous || hybridResult.negated) {
        semantic = {
            ...semantic,
            action: "unknown",
            confidence: 0,
            matchedWords: [],
        };
    }
    const actionEvidence = (0, action_concept_engine_1.detectActionConcept)(normalized);
    const reliableBaselineAction = semantic.action !== "unknown" && semantic.confidence >= 0.7;
    const baselineAction = semantic.action;
    const transinfantEnabled = options.transinfantEnabled ?? (0, interpretation_adapter_1.isTransInfantEnabled)();
    const transinfantResult = await (0, interpretation_adapter_1.interpretWithLearnedKnowledge)({
        text: normalized,
        baselineAction: semantic.action,
        baselineObject: semantic.object,
        explicitAction: hybridResult.ambiguous ||
            hybridResult.negated ||
            (actionEvidence.action !== "unknown" &&
                actionEvidence.matchedPhrase !== "new") ||
            reliableBaselineAction,
        explicitObject: semanticObject !== "unknown",
    }, transinfantEnabled, options.transinfantStore ?? memory_store_1.knowledgeStore, options.transinfantMode ?? "composition");
    const grammarPatternResult = options.grammarPatternStore
        ? transinfantEnabled
            ? await interpretWithStoredPattern(normalized, options.grammarPatternStore, options.transinfantStore ?? memory_store_1.knowledgeStore)
            : {
                status: "disabled",
                frame: null,
                recognizedTokens: normalized.match(/[\p{L}\p{N}]+/gu) ?? [],
                patternId: null,
                patternVersion: null,
                source: null,
                provenance: [],
                recognizedConcepts: [],
                vocabularyProvenance: [],
                confidence: null,
                reason: "TransInfant is disabled.",
            }
        : undefined;
    let learnedActionApplied = false;
    if (transinfantResult.status === "applied" && transinfantResult.candidate) {
        const hadBaselineFrameSignal = semantic.action !== "unknown" ||
            semantic.object !== "unknown";
        const learnedAction = transinfantResult.candidate.action
            ? mapHybridAction(transinfantResult.candidate.action)
            : semantic.action;
        const learnedObject = transinfantResult.candidate.object
            ? mapHybridObject(transinfantResult.candidate.object)
            : semantic.object;
        learnedActionApplied =
            learnedAction !== baselineAction && !reliableBaselineAction;
        semantic = {
            action: learnedAction,
            object: learnedObject,
            confidence: hadBaselineFrameSignal
                ? Math.min(semantic.confidence, transinfantResult.candidate.confidence)
                : transinfantResult.candidate.confidence,
            matchedWords: [
                ...semantic.matchedWords,
                "transinfant",
            ],
        };
    }
    const reference = (0, reference_engine_1.resolveReference)(normalized, previousTurn?.semantic, previousTurn?.entities ?? [], semantic, allEntities);
    const newNameEntity = findEntity(allEntities, "new_name");
    const directNameEntity = findEntity(allEntities, "name");
    const previousTargetEntity = previousTurn?.entities.find((entity) => entity.type === "target_name");
    let targetName = null;
    if (newNameEntity) {
        targetName = newNameEntity.value;
    }
    else if (directNameEntity) {
        targetName = directNameEntity.value;
    }
    else if (reference.referencedName) {
        targetName = reference.referencedName;
    }
    else if (previousTargetEntity) {
        targetName = previousTargetEntity.value;
    }
    const withoutTarget = allEntities.filter((entity) => entity.type !== "target_name");
    if (targetName) {
        withoutTarget.push({
            type: "target_name",
            value: targetName,
            confidence: newNameEntity?.confidence ??
                directNameEntity?.confidence ??
                reference.confidence ??
                previousTargetEntity?.confidence ??
                0.90,
        });
    }
    const finalEntities = withoutTarget;
    const intentName = learnedActionApplied
        ? mapSemanticActionToIntent(semantic.action)
        : hybridResult.intent;
    const intentConfidence = learnedActionApplied
        ? transinfantResult.candidate?.confidence ?? hybridResult.confidence
        : hybridResult.confidence;
    const dialogueState = session.dialogue ??
        (0, dialogue_manager_1.createDialogueMemory)(sessionId);
    const dialogueResult = (0, dialogue_manager_1.processDialogueTurn)(dialogueState, normalized, {
        intent: intentName,
        semantic,
        entities: finalEntities,
    });
    session.dialogue = dialogueResult.state;
    (0, context_engine_1.addTurn)(sessionId, {
        input: normalized,
        semantic,
        entities: finalEntities,
    });
    let status;
    if (hybridResult.intent === "unknown" &&
        semantic.action === "unknown" &&
        !reference.hasReference) {
        status = "unknown";
    }
    else if (hybridResult.confidence < 0.5 &&
        semantic.confidence < 0.7 &&
        reference.confidence < 0.7) {
        status = "uncertain";
    }
    else {
        status = "understood";
    }
    return {
        status,
        intent: {
            name: intentName,
            confidence: intentConfidence,
        },
        semantic,
        reference,
        entities: finalEntities,
        context: {
            normalizedText: normalized,
            sessionId,
            tokens: linguistic.tokens,
            lemmas: linguistic.lemmas,
            nouns: linguistic.nouns,
            verbs: linguistic.verbs,
            adjectives: linguistic.adjectives,
            adverbs: linguistic.adverbs,
            conversation: {
                hasPreviousTurn: previousTurn !== undefined,
                previousInput: previousTurn?.input ?? null,
                previousSemantic: previousTurn?.semantic ?? null,
                previousEntities: previousTurn?.entities ?? [],
                historyLength: session.history.length,
            },
            hybrid: {
                lexicalScore: hybridResult.lexicalScore,
                semanticScore: hybridResult.semanticScore,
                keywordScore: hybridResult.keywordScore,
                actionConcept: hybridResult.actionConcept,
                workspaceObject: hybridResult.workspaceObject,
                matchedTrainingText: hybridResult.matchedTrainingText,
                actionAlternatives: hybridResult.actionAlternatives,
                ambiguous: hybridResult.ambiguous,
                negated: hybridResult.negated,
            },
            dialogue: {
                act: dialogueResult.dialogueAct,
                summary: dialogueResult.summary,
                clarification: dialogueResult.clarification,
                state: dialogueResult.state,
            },
            transinfant: {
                status: transinfantResult.status,
                reason: transinfantResult.reason,
                candidate: transinfantResult.candidate,
                conceptCount: transinfantResult.conceptCount,
                relationshipCount: transinfantResult.relationshipCount,
                ...(grammarPatternResult ? { grammarPattern: grammarPatternResult } : {}),
            },
        },
    };
}
