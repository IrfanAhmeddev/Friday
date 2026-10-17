import type { NLUResult } from "./nlu";

export const INTELLIGENCE_CONTRACT_VERSION = "1.0" as const;

export interface IntelligenceContract {
  contractVersion: typeof INTELLIGENCE_CONTRACT_VERSION;
  originalInput: string;
  normalizedUtterance: string;
  resultStatus: NLUResult["status"];
  intent: {
    name: string;
    confidence: number;
  };
  semantic: NLUResult["semantic"];
  entities: NLUResult["entities"];
  reference: NLUResult["reference"];
  conversation: {
    sessionId: string;
    historyLength: number;
    previousInput: string | null;
    previousSemantic: NLUResult["semantic"] | null;
    previousEntities: NLUResult["entities"];
  };
  dialogue: {
    act: string | null;
    activeTopic: string | null;
    taskType: string | null;
    parameters: Record<string, string>;
    pendingQuestions: string[];
  };
  constraints: string[];
  confidence: {
    score: number;
    uncertainty: number;
    basis: "heuristic";
  };
  ambiguity: {
    detected: boolean;
    candidateActions: NLUResult["semantic"]["action"][];
  };
  clarification: {
    required: boolean;
    question: string | null;
  };
  conceptualEvidence: {
    status: "disabled" | "no-match" | "applied" | "degraded" | "unavailable";
    action: string | null;
    object: string | null;
    confidence: number | null;
    evidence: string[];
  };
  planning: {
    status: "not_proposed";
    steps: [];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contextString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new TypeError(`Context field ${key} must be a string or null.`);
  }
  return value;
}

function contextStringArray(
  record: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const value = record?.[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`Context field ${key} must be an array of strings.`);
  }
  return [...value];
}

function assertConfidence(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number from 0 to 1.`);
  }
}

const SEMANTIC_ACTIONS: NLUResult["semantic"]["action"][] = [
  "create", "open", "search", "show", "delete", "remove",
  "rename", "edit", "close", "unknown",
];
const SEMANTIC_OBJECTS: NLUResult["semantic"]["object"][] = [
  "document", "spreadsheet", "presentation", "note", "file",
  "folder", "application", "report", "project", "unknown",
];

function isSemanticAction(value: unknown): value is NLUResult["semantic"]["action"] {
  return SEMANTIC_ACTIONS.some((action) => action === value);
}

function isSemanticObject(value: unknown): value is NLUResult["semantic"]["object"] {
  return SEMANTIC_OBJECTS.some((object) => object === value);
}

function isReferenceKind(value: unknown): value is NLUResult["reference"]["reference"] {
  return value === "previous" || value === "current" || value === "unknown";
}

function semanticFromContext(value: unknown): NLUResult["semantic"] | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value) ||
    !isSemanticAction(value.action) ||
    !isSemanticObject(value.object) ||
    !Array.isArray(value.matchedWords) ||
    !value.matchedWords.every((item) => typeof item === "string")
  ) {
    throw new TypeError("Previous semantic state is invalid.");
  }
  assertConfidence(value.confidence, "conversation.previousSemantic.confidence");
  return {
    action: value.action,
    object: value.object,
    confidence: value.confidence,
    matchedWords: [...value.matchedWords],
  };
}

function entitiesFromContext(value: unknown): NLUResult["entities"] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError("Previous entity state is invalid.");
  }
  return value.map((entity, index) => {
    if (
      !isRecord(entity) ||
      typeof entity.type !== "string" ||
      typeof entity.value !== "string"
    ) {
      throw new TypeError(`conversation.previousEntities[${index}] is invalid.`);
    }
    assertConfidence(
      entity.confidence,
      `conversation.previousEntities[${index}].confidence`,
    );
    if (
      (entity.start !== undefined && typeof entity.start !== "number") ||
      (entity.end !== undefined && typeof entity.end !== "number")
    ) {
      throw new TypeError(`conversation.previousEntities[${index}] offsets are invalid.`);
    }
    return {
      type: entity.type,
      value: entity.value,
      confidence: entity.confidence,
      ...(typeof entity.start === "number" ? { start: entity.start } : {}),
      ...(typeof entity.end === "number" ? { end: entity.end } : {}),
    };
  });
}

function stringRecordFromContext(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, string> {
  const value = record?.[key];
  if (value === undefined) return {};
  if (
    !isRecord(value) ||
    !Object.entries(value).every(([, item]) => typeof item === "string")
  ) {
    throw new TypeError(`Dialogue state ${key} must contain string values.`);
  }
  const result: Record<string, string> = {};
  for (const [field, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new TypeError(`Dialogue state ${key} must contain string values.`);
    }
    result[field] = item;
  }
  return result;
}

function assertIntelligenceContract(
  value: unknown,
): asserts value is IntelligenceContract {
  if (!isRecord(value) || value.contractVersion !== INTELLIGENCE_CONTRACT_VERSION) {
    throw new TypeError("Unsupported intelligence contract version.");
  }
  if (
    typeof value.originalInput !== "string" ||
    typeof value.normalizedUtterance !== "string" ||
    (value.resultStatus !== "understood" &&
      value.resultStatus !== "uncertain" &&
      value.resultStatus !== "unknown") ||
    !isRecord(value.intent) ||
    typeof value.intent.name !== "string" ||
    !isRecord(value.semantic) ||
    !Array.isArray(value.entities) ||
    !isRecord(value.reference) ||
    !isRecord(value.conversation) ||
    !Array.isArray(value.constraints) ||
    !isRecord(value.confidence) ||
    !isRecord(value.ambiguity) ||
    !isRecord(value.clarification) ||
    !isRecord(value.conceptualEvidence) ||
    !isRecord(value.planning) ||
    !Array.isArray(value.planning.steps)
  ) {
    throw new TypeError("Intelligence contract does not match version 1.0.");
  }
  if (
    !isSemanticAction(value.semantic.action) ||
    !isSemanticObject(value.semantic.object) ||
    !Array.isArray(value.semantic.matchedWords) ||
    !value.semantic.matchedWords.every((item) => typeof item === "string") ||
    typeof value.reference.hasReference !== "boolean" ||
    !isReferenceKind(value.reference.reference) ||
    !isSemanticObject(value.reference.referencedObject) ||
    (value.reference.referencedName !== null &&
      typeof value.reference.referencedName !== "string") ||
    !Array.isArray(value.reference.matchedWords) ||
    !value.reference.matchedWords.every((item) => typeof item === "string") ||
    !["disabled", "no-match", "applied", "degraded", "unavailable"]
      .includes(String(value.conceptualEvidence.status)) ||
    (value.conceptualEvidence.action !== null &&
      typeof value.conceptualEvidence.action !== "string") ||
    (value.conceptualEvidence.object !== null &&
      typeof value.conceptualEvidence.object !== "string") ||
    value.confidence.basis !== "heuristic"
  ) {
    throw new TypeError("Intelligence contract contains invalid semantic fields.");
  }
  assertConfidence(value.intent.confidence, "intent.confidence");
  assertConfidence(value.semantic.confidence, "semantic.confidence");
  assertConfidence(value.reference.confidence, "reference.confidence");
  assertConfidence(value.confidence.score, "confidence.score");
  assertConfidence(value.confidence.uncertainty, "confidence.uncertainty");
  if (
    typeof value.conversation.sessionId !== "string" ||
    typeof value.conversation.historyLength !== "number" ||
    !Number.isInteger(value.conversation.historyLength) ||
    value.conversation.historyLength < 0 ||
    (value.conversation.previousInput !== null &&
      typeof value.conversation.previousInput !== "string") ||
    (value.conversation.previousSemantic !== null &&
      !isRecord(value.conversation.previousSemantic)) ||
    !Array.isArray(value.conversation.previousEntities) ||
    !isRecord(value.dialogue) ||
    (value.dialogue.act !== null && typeof value.dialogue.act !== "string") ||
    (value.dialogue.activeTopic !== null &&
      typeof value.dialogue.activeTopic !== "string") ||
    (value.dialogue.taskType !== null &&
      typeof value.dialogue.taskType !== "string") ||
    !isRecord(value.dialogue.parameters) ||
    !Object.values(value.dialogue.parameters).every((item) => typeof item === "string") ||
    !Array.isArray(value.dialogue.pendingQuestions) ||
    !value.dialogue.pendingQuestions.every((item) => typeof item === "string") ||
    !value.constraints.every((item) => typeof item === "string") ||
    typeof value.ambiguity.detected !== "boolean" ||
    !Array.isArray(value.ambiguity.candidateActions) ||
    !value.ambiguity.candidateActions.every((action) =>
      SEMANTIC_ACTIONS.some((knownAction) =>
        knownAction !== "unknown" && knownAction === action,
      ),
    ) ||
    typeof value.clarification.required !== "boolean" ||
    (value.clarification.question !== null &&
      typeof value.clarification.question !== "string") ||
    value.clarification.required !== (value.clarification.question !== null) ||
    !Array.isArray(value.conceptualEvidence.evidence) ||
    !value.conceptualEvidence.evidence.every((item) => typeof item === "string") ||
    value.planning.status !== "not_proposed" ||
    value.planning.steps.length !== 0
  ) {
    throw new TypeError("Intelligence contract contains invalid version 1.0 fields.");
  }
  if (
    value.conceptualEvidence.confidence !== null
  ) {
    assertConfidence(
      value.conceptualEvidence.confidence,
      "conceptualEvidence.confidence",
    );
  }
  if (
    Math.abs(
      value.confidence.score +
        value.confidence.uncertainty -
        1,
    ) > 1e-9
  ) {
    throw new TypeError("confidence.uncertainty must complement confidence.score.");
  }
  for (const [index, entity] of value.entities.entries()) {
    if (
      !isRecord(entity) ||
      typeof entity.type !== "string" ||
      typeof entity.value !== "string"
    ) {
      throw new TypeError(`entities[${index}] is invalid.`);
    }
    assertConfidence(entity.confidence, `entities[${index}].confidence`);
    if (
      (entity.start !== undefined &&
        (typeof entity.start !== "number" ||
          !Number.isInteger(entity.start) ||
          entity.start < 0)) ||
      (entity.end !== undefined &&
        (typeof entity.end !== "number" ||
          !Number.isInteger(entity.end) ||
          entity.end < 0)) ||
      (typeof entity.start === "number" &&
        typeof entity.end === "number" &&
        entity.end < entity.start)
    ) {
      throw new TypeError(`entities[${index}] has invalid offsets.`);
    }
  }
  semanticFromContext(value.conversation.previousSemantic);
  entitiesFromContext(value.conversation.previousEntities);
  stringRecordFromContext(value.dialogue, "parameters");
  contextStringArray(value.dialogue, "pendingQuestions");
}

export function validateIntelligenceContract(
  value: unknown,
): IntelligenceContract {
  assertIntelligenceContract(value);
  return value;
}

export function createIntelligenceContract(
  originalInput: string,
  result: NLUResult,
  sessionId?: string,
): IntelligenceContract {
  const context = result.context;
  const conversation = isRecord(context.conversation)
    ? context.conversation
    : undefined;
  const dialogue = isRecord(context.dialogue) ? context.dialogue : undefined;
  const dialogueState = isRecord(dialogue?.state) ? dialogue.state : undefined;
  const hybrid = isRecord(context.hybrid) ? context.hybrid : undefined;
  const transinfant = isRecord(context.transinfant)
    ? context.transinfant
    : undefined;
  const candidate = isRecord(transinfant?.candidate)
    ? transinfant.candidate
    : undefined;
  const dialogueClarification = contextString(dialogue, "clarification");
  const dialogueAct = contextString(dialogue, "act");
  const rawAlternatives = hybrid?.actionAlternatives;
  const candidateActions = Array.isArray(rawAlternatives)
    ? rawAlternatives.filter((action): action is NLUResult["semantic"]["action"] =>
        ["create", "open", "search", "show", "delete", "remove", "rename", "edit", "close"]
          .includes(String(action)),
      )
    : [];
  const ambiguityDetected =
    hybrid?.ambiguous === true || candidateActions.length > 1;
  const targetMissing =
    result.semantic.action !== "unknown" &&
    result.semantic.object === "unknown";
  const requiresClarification =
    result.status === "uncertain" ||
    (result.status === "unknown" &&
      dialogueAct !== "greeting" &&
      dialogueAct !== "acknowledge") ||
    dialogueAct === "clarify" ||
    dialogueClarification !== null ||
    ambiguityDetected ||
    targetMissing;
  const combinedConfidence = Math.min(
    result.intent.confidence,
    result.semantic.confidence,
  );
  const evidence = candidate?.evidence;
  if (
    evidence !== undefined &&
    (!Array.isArray(evidence) ||
      !evidence.every((item) => typeof item === "string"))
  ) {
    throw new TypeError("TransInfant evidence in the NLU context is invalid.");
  }
  const contract: IntelligenceContract = {
    contractVersion: INTELLIGENCE_CONTRACT_VERSION,
    originalInput,
    normalizedUtterance: contextString(context, "normalizedText") ?? originalInput.trim(),
    resultStatus: result.status,
    intent: { ...result.intent },
    semantic: { ...result.semantic, matchedWords: [...result.semantic.matchedWords] },
    entities: result.entities.map((entity) => ({ ...entity })),
    reference: { ...result.reference, matchedWords: [...result.reference.matchedWords] },
    conversation: {
      sessionId: contextString(context, "sessionId") ?? sessionId ?? "unknown",
      historyLength: typeof conversation?.historyLength === "number"
        ? conversation.historyLength
        : 0,
      previousInput: contextString(conversation, "previousInput"),
      previousSemantic: semanticFromContext(conversation?.previousSemantic),
      previousEntities: entitiesFromContext(conversation?.previousEntities),
    },
    dialogue: {
      act: contextString(dialogue, "act"),
      activeTopic: contextString(dialogueState, "activeTopic"),
      taskType: contextString(dialogueState, "taskType"),
      parameters: stringRecordFromContext(dialogueState, "parameters"),
      pendingQuestions: contextStringArray(dialogueState, "pendingQuestions"),
    },
    constraints: contextStringArray(dialogueState, "constraints"),
    confidence: {
      score: combinedConfidence,
      uncertainty: 1 - combinedConfidence,
      basis: "heuristic",
    },
    ambiguity: {
      detected: ambiguityDetected,
      candidateActions,
    },
    clarification: {
      required: requiresClarification,
      question: requiresClarification
        ? dialogueClarification ??
          (ambiguityDetected
            ? "Your request includes multiple actions. Which should I interpret?"
            : targetMissing
              ? `What would you like me to ${result.semantic.action}?`
              : "Could you clarify what you would like me to do?")
        : null,
    },
    conceptualEvidence: {
      status: transinfant?.status === "disabled" ||
          transinfant?.status === "no-match" ||
          transinfant?.status === "applied" ||
          transinfant?.status === "degraded"
        ? transinfant.status
        : "unavailable",
      action: typeof candidate?.action === "string" ? candidate.action : null,
      object: typeof candidate?.object === "string" ? candidate.object : null,
      confidence: typeof candidate?.confidence === "number"
        ? candidate.confidence
        : null,
      evidence: evidence === undefined ? [] : [...evidence],
    },
    planning: {
      status: "not_proposed",
      steps: [],
    },
  };
  return validateIntelligenceContract(contract);
}
