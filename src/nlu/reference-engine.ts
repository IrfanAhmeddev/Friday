
import {
  Entity,
  SemanticResult
} from "../types/nlu";

export interface ReferenceResult {
  hasReference: boolean;

  reference:
    | "previous"
    | "current"
    | "unknown";

  referencedObject:
    | SemanticResult["object"]
    | "unknown";

  referencedName: string | null;

  matchedWords: string[];

  confidence: number;
}

const PREVIOUS_REFERENCES = new Set([
  "it",
  "that",
  "one",
  "previous",
  "previous one"
]);

const CURRENT_REFERENCES = new Set([
  "this",
  "this one"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) =>
      word.replace(/[^\w]/g, "")
    )
    .filter(Boolean);
}

function detectReference(
  tokens: string[]
): {
  reference:
    | "previous"
    | "current"
    | "unknown";

  matchedWords: string[];
} {
  const matchedWords: string[] = [];

  for (const token of tokens) {
    if (PREVIOUS_REFERENCES.has(token)) {
      matchedWords.push(token);
    }

    if (CURRENT_REFERENCES.has(token)) {
      matchedWords.push(token);
    }
  }

  if (matchedWords.length === 0) {
    return {
      reference: "unknown",
      matchedWords: []
    };
  }

  const hasPrevious =
    matchedWords.some((word) =>
      PREVIOUS_REFERENCES.has(word)
    );

  return {
    reference: hasPrevious
      ? "previous"
      : "current",

    matchedWords
  };
}

function findEntity(
  entities: Entity[],
  type: string
): Entity | undefined {
  return entities.find(
    (entity) => entity.type === type
  );
}

function findTargetName(
  entities: Entity[]
): string | null {
  const targetName = findEntity(
    entities,
    "target_name"
  );

  if (targetName) {
    return targetName.value;
  }

  const newName = findEntity(
    entities,
    "new_name"
  );

  if (newName) {
    return newName.value;
  }

  const name = findEntity(
    entities,
    "name"
  );

  if (name) {
    return name.value;
  }

  return null;
}

export function resolveReference(
  text: string,
  previousSemantic?: SemanticResult,
  previousEntities: Entity[] = [],
  currentSemantic?: SemanticResult,
  currentEntities: Entity[] = []
): ReferenceResult {
  const tokens = tokenize(text);

  const referenceResult =
    detectReference(tokens);

  if (
    referenceResult.reference === "unknown"
  ) {
    return {
      hasReference: false,
      reference: "unknown",
      referencedObject: "unknown",
      referencedName: null,
      matchedWords: [],
      confidence: 0
    };
  }

  /*
   * If the current command explicitly specifies
   * an object, that object has priority.
   *
   * Example:
   *
   * Previous:
   * show my notes
   *
   * Current:
   * delete this file
   *
   * The reference is "current", but the object
   * is explicitly "file", not "note".
   */
  const currentObjectEntity = findEntity(
    currentEntities,
    "workspace_object"
  );

  const currentObject =
    currentSemantic?.object !== "unknown"
      ? currentSemantic?.object
      : currentObjectEntity?.value as
          | SemanticResult["object"]
          | undefined;

  /*
   * If there is no previous turn, we can still
   * resolve the explicitly stated current object.
   */
  if (!previousSemantic) {
    return {
      hasReference: true,

      reference:
        referenceResult.reference,

      referencedObject:
        currentObject ?? "unknown",

      referencedName: null,

      matchedWords:
        referenceResult.matchedWords,

      confidence:
        currentObject
          ? 0.80
          : 0.40
    };
  }

  /*
   * Explicit current object wins over the
   * previous conversational object.
   */
  const referencedObject =
    currentObject ??
    (
      previousSemantic.object !== "unknown"
        ? previousSemantic.object
        : findEntity(
            previousEntities,
            "workspace_object"
          )?.value as
            | SemanticResult["object"]
            | undefined
    );

  /*
   * Target name still comes from the current
   * command first, then previous target.
   */
  const currentTargetName =
    findTargetName(currentEntities);

  const previousTargetName =
    findTargetName(previousEntities);

  const referencedName =
    currentTargetName ??
    previousTargetName;

  let confidence = 0.70;

  if (referencedObject !== "unknown") {
    confidence += 0.15;
  }

  if (referencedName) {
    confidence += 0.05;
  }

  return {
    hasReference: true,

    reference:
      referenceResult.reference,

    referencedObject:
      referencedObject ?? "unknown",

    referencedName,

    matchedWords:
      referenceResult.matchedWords,

    confidence:
      Math.min(
        Number(confidence.toFixed(3)),
        0.95
      )
  };
}
