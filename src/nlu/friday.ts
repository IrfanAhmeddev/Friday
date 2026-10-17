import { normalizeText } from "./normalizer";
import { analyzeText } from "./wink-engine";
import { extractEntities } from "./entity-engine";
import { detectConversationalSemantic } from "./conversation-semantic-engine";
import {
  extractConversationalEntities,
} from "./conversation-entity-engine";

import {
  getOrCreateSession,
  addTurn,
  getLastMeaningfulTurn,
} from "./context-engine";

import { resolveReference } from "./reference-engine";

import {
  understandIntent,
  type EmbeddingProvider,
} from "./hybrid-intent-engine";
import { detectActionConcept } from "./action-concept-engine";

import {
  createDialogueMemory,
  processDialogueTurn,
  summarizeDialogueState,
} from "./dialogue-manager";
import {
  interpretWithLearnedKnowledge,
  isTransInfantEnabled,
  type InterpretationMode,
} from "../transinfant/interpretation-adapter";
import {
  knowledgeStore,
  type KnowledgeStore,
} from "../transinfant/memory-store";
import {
  GrammarPatternStore,
  interpretWithGrammarPattern,
  type PatternInterpretation,
} from "../transinfant/grammar-pattern";
import { inspectKnowledge } from "../transinfant/learner";

import {
  NLUResult,
  Entity,
  SemanticAction,
  SemanticObject,
  SemanticResult,
} from "../types/nlu";

export interface UnderstandOptions {
  transinfantEnabled?: boolean;
  transinfantStore?: KnowledgeStore;
  transinfantMode?: InterpretationMode;
  grammarPatternStore?: GrammarPatternStore;
  embeddingProvider?: EmbeddingProvider;
}

function mapHybridAction(
  action: string,
): SemanticAction {
  const supportedActions: SemanticAction[] = [
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

  if (
    supportedActions.includes(
      action as SemanticAction,
    )
  ) {
    return action as SemanticAction;
  }

  return "unknown";
}

function mapHybridObject(
  object: string,
): SemanticObject {
  const supportedObjects: SemanticObject[] = [
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

  if (
    supportedObjects.includes(
      object as SemanticObject,
    )
  ) {
    return object as SemanticObject;
  }

  return "unknown";
}

function createSemanticFromHybrid(
  action: string,
  object: string,
  confidence: number,
  matchedWords: string[],
): SemanticResult {
  return {
    action: mapHybridAction(action),
    object: mapHybridObject(object),
    confidence,
    matchedWords,
  };
}

function findEntity(
  entities: Entity[],
  type: string,
): Entity | undefined {
  return entities.find(
    (entity) => entity.type === type,
  );
}

function resolveExplicitWorkspaceObject(
  entities: Entity[],
): SemanticObject | null {
  const workspaceEntity = findEntity(
    entities,
    "workspace_object",
  );

  if (!workspaceEntity) {
    return null;
  }

  const object = mapHybridObject(
    workspaceEntity.value,
  );

  return object !== "unknown"
    ? object
    : null;
}

function resolveSemanticObject(
  hybridObject: string,
  entities: Entity[],
): SemanticObject {
  const explicitObject =
    resolveExplicitWorkspaceObject(entities);

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

function extractRenameTarget(
  text: string,
): Entity | undefined {
  const renameMatch = text.match(
    /\b(?:rename|name)\b[\s\S]*?\b(?:to|as)\b\s+(.+?)\s*$/i,
  );

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

async function interpretWithStoredPattern(
  text: string,
  patternStore: GrammarPatternStore,
  vocabularyStore: KnowledgeStore,
): Promise<PatternInterpretation & {
  recognizedConcepts: string[];
  vocabularyProvenance: Array<{
    token: string;
    relationshipId: string;
    experienceId: string;
    source: string;
    confidence: number;
  }>;
}> {
  const tokens = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  try {
    const snapshot = await inspectKnowledge(vocabularyStore);
    const conceptsByToken: Record<string, string> = {};
    const knownTokens: string[] = [];
    const vocabularyProvenance: Array<{
      token: string;
      relationshipId: string;
      experienceId: string;
      source: string;
      confidence: number;
    }> = [];
    for (const token of tokens) {
      const inputIds = snapshot.symbols
        .filter((symbol) => symbol.normalized === token)
        .filter((symbol) =>
          snapshot.concepts.some((concept) =>
            concept.id === symbol.conceptId &&
            concept.attributes.vocabularyKind === "word",
          ),
        )
        .map((symbol) => symbol.conceptId);
      const relations = snapshot.relationships.filter(
        (relationship) =>
          inputIds.includes(relationship.subject) &&
          relationship.predicate === "denotes" &&
          relationship.status === "accepted",
      );
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
    const result = await interpretWithGrammarPattern(
      text,
      patternStore,
      conceptsByToken,
      knownTokens,
    );
    return {
      ...result,
      recognizedConcepts: knownTokens.map((token) => conceptsByToken[token]),
      vocabularyProvenance,
    };
  } catch (error) {
    return {
      status: "degraded",
      frame: null,
      recognizedTokens: tokens,
      patternId: null,
      patternVersion: null,
      source: null,
      provenance: [],
      confidence: null,
      reason: error instanceof Error ? error.message : String(error),
      recognizedConcepts: [],
      vocabularyProvenance: [],
    };
  }
}

export async function understand(
  text: string,
  sessionId = "default",
  options: UnderstandOptions = {},
): Promise<NLUResult> {
  const normalized = normalizeText(text);

  const linguistic = analyzeText(normalized);

  const extractedEntities = extractEntities(
    normalized,
    linguistic,
  );

  const conversationalEntities =
    extractConversationalEntities(normalized);

  const session = getOrCreateSession(sessionId);

  const previousTurn =
    getLastMeaningfulTurn(sessionId);

  const hybridResult =
    await understandIntent(normalized, options.embeddingProvider);

  const conversationalSemantic =
    detectConversationalSemantic(
      normalized,
      previousTurn?.semantic,
      previousTurn?.entities ?? [],
    );

  const allEntities: Entity[] = [
    ...extractedEntities,
    ...conversationalEntities,
  ];

  const renameTarget = extractRenameTarget(
    normalized,
  );

  if (
    renameTarget &&
    !findEntity(allEntities, "new_name")
  ) {
    allEntities.push(renameTarget);
  }

  const semanticObject =
    resolveSemanticObject(
      hybridResult.workspaceObject,
      allEntities,
    );

  let semantic: SemanticResult;

  if (
    hybridResult.actionConcept !== "unknown" &&
    semanticObject !== "unknown"
  ) {
    semantic = createSemanticFromHybrid(
      hybridResult.actionConcept,
      semanticObject,
      hybridResult.confidence,
      [
        hybridResult.actionConcept,
        semanticObject,
      ],
    );
  } else if (
    conversationalSemantic.action !== "unknown"
  ) {
    semantic = {
      action:
        conversationalSemantic.action as SemanticAction,
      object:
        conversationalSemantic.object as SemanticObject,
      confidence:
        conversationalSemantic.confidence,
      matchedWords:
        conversationalSemantic.matchedWords,
    };
  } else {
    semantic = {
      action: mapHybridAction(
        hybridResult.actionConcept,
      ),
      object: semanticObject,
      confidence: hybridResult.confidence,
      matchedWords: [],
    };
  }

  const actionEvidence = detectActionConcept(normalized);
  const transinfantEnabled =
    options.transinfantEnabled ?? isTransInfantEnabled();
  const transinfantResult = await interpretWithLearnedKnowledge(
    {
      text: normalized,
      baselineAction: semantic.action,
      baselineObject: semantic.object,
      explicitAction:
        actionEvidence.action !== "unknown" &&
        actionEvidence.matchedPhrase !== "new",
      explicitObject: semanticObject !== "unknown",
    },
    transinfantEnabled,
    options.transinfantStore ?? knowledgeStore,
    options.transinfantMode ?? "composition",
  );
  const grammarPatternResult = options.grammarPatternStore
    ? transinfantEnabled
      ? await interpretWithStoredPattern(
          normalized,
          options.grammarPatternStore,
          options.transinfantStore ?? knowledgeStore,
        )
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

  if (transinfantResult.status === "applied" && transinfantResult.candidate) {
    const hadBaselineFrameSignal =
      semantic.action !== "unknown" ||
      semantic.object !== "unknown";
    const learnedAction = transinfantResult.candidate.action
      ? mapHybridAction(transinfantResult.candidate.action)
      : semantic.action;
    const learnedObject = transinfantResult.candidate.object
      ? mapHybridObject(transinfantResult.candidate.object)
      : semantic.object;
    semantic = {
      action: learnedAction,
      object: learnedObject,
      confidence: hadBaselineFrameSignal
        ? Math.min(
            semantic.confidence,
            transinfantResult.candidate.confidence,
          )
        : transinfantResult.candidate.confidence,
      matchedWords: [
        ...semantic.matchedWords,
        "transinfant",
      ],
    };
  }

  const reference = resolveReference(
    normalized,
    previousTurn?.semantic,
    previousTurn?.entities ?? [],
    semantic,
    allEntities,
  );

  const newNameEntity =
    findEntity(allEntities, "new_name");

  const directNameEntity =
    findEntity(allEntities, "name");

  const previousTargetEntity =
    previousTurn?.entities.find(
      (entity) =>
        entity.type === "target_name",
    );

  let targetName: string | null = null;

  if (newNameEntity) {
    targetName = newNameEntity.value;
  } else if (directNameEntity) {
    targetName = directNameEntity.value;
  } else if (reference.referencedName) {
    targetName = reference.referencedName;
  } else if (previousTargetEntity) {
    targetName = previousTargetEntity.value;
  }

  const withoutTarget = allEntities.filter(
    (entity) =>
      entity.type !== "target_name",
  );

  if (targetName) {
    withoutTarget.push({
      type: "target_name",
      value: targetName,
      confidence:
        newNameEntity?.confidence ??
        directNameEntity?.confidence ??
        reference.confidence ??
        previousTargetEntity?.confidence ??
        0.90,
    });
  }

  const finalEntities = withoutTarget;
  const intentName =
    hybridResult.intent === "unknown" &&
    transinfantResult.status === "applied" &&
    semantic.action !== "unknown"
      ? `workspace.${semantic.action}`
      : hybridResult.intent;
  const intentConfidence =
    transinfantResult.status === "applied"
      ? Math.max(
          hybridResult.confidence,
          transinfantResult.candidate?.confidence ?? 0,
        )
      : hybridResult.confidence;

  const dialogueState =
    session.dialogue ??
    createDialogueMemory(sessionId);

  const dialogueResult = processDialogueTurn(
    dialogueState,
    normalized,
    {
      intent: intentName,
      semantic,
      entities: finalEntities,
    },
  );

  session.dialogue = dialogueResult.state;

  addTurn(sessionId, {
    input: normalized,
    semantic,
    entities: finalEntities,
  });

  let status: NLUResult["status"];

  if (
    hybridResult.intent === "unknown" &&
    semantic.action === "unknown" &&
    !reference.hasReference
  ) {
    status = "unknown";
  } else if (
    hybridResult.confidence < 0.5 &&
    semantic.confidence < 0.7 &&
    reference.confidence < 0.7
  ) {
    status = "uncertain";
  } else {
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
        hasPreviousTurn:
          previousTurn !== undefined,

        previousInput:
          previousTurn?.input ?? null,

        previousSemantic:
          previousTurn?.semantic ?? null,

        previousEntities:
          previousTurn?.entities ?? [],

        historyLength:
          session.history.length,
      },

      hybrid: {
        lexicalScore:
          hybridResult.lexicalScore,

        semanticScore:
          hybridResult.semanticScore,

        keywordScore:
          hybridResult.keywordScore,

        actionConcept:
          hybridResult.actionConcept,

        workspaceObject:
          hybridResult.workspaceObject,

        matchedTrainingText:
          hybridResult.matchedTrainingText,
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