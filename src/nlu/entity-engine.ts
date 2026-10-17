import { LinguisticAnalysis } from "./wink-engine";
import { Entity } from "../types/nlu";

interface EntityRule {
  type: string;
  values: string[];
}

const WORKSPACE_OBJECTS: EntityRule[] = [
  {
    type: "workspace_object",
    values: [
      "document",
      "documents",
      "spreadsheet",
      "spreadsheets",
      "presentation",
      "presentations",
      "note",
      "notes",
      "file",
      "files",
      "folder",
      "folders"
    ]
  }
];

const MODIFIERS = new Set([
  "latest",
  "recent",
  "new",
  "old",
  "first",
  "last",
  "next",
  "previous"
]);

export function extractEntities(
  text: string,
  linguistic: LinguisticAnalysis
): Entity[] {
  const entities: Entity[] = [];

  const tokens = linguistic.tokens;
  const normalized = text.toLowerCase();

  // --------------------------------------------------
  // 1. Workspace object detection
  // --------------------------------------------------

  for (const rule of WORKSPACE_OBJECTS) {
    for (const value of rule.values) {
      if (tokens.includes(value)) {
        const canonicalValue = value.endsWith("s")
          ? value.slice(0, -1)
          : value;

        entities.push({
          type: rule.type,
          value: canonicalValue,
          confidence: 0.98
        });

        break;
      }
    }
  }

  // --------------------------------------------------
  // 2. "called <name>" detection
  // --------------------------------------------------

  const calledIndex = tokens.indexOf("called");

  if (calledIndex !== -1 && calledIndex < tokens.length - 1) {
    const nameTokens = tokens.slice(calledIndex + 1);

    if (nameTokens.length > 0) {
      entities.push({
        type: "name",
        value: nameTokens.join(" "),
        confidence: 0.95
      });
    }
  }

  // --------------------------------------------------
  // 3. "named <name>" detection
  // --------------------------------------------------

  const namedIndex = tokens.indexOf("named");

  if (namedIndex !== -1 && namedIndex < tokens.length - 1) {
    const nameTokens = tokens.slice(namedIndex + 1);

    if (nameTokens.length > 0) {
      entities.push({
        type: "name",
        value: nameTokens.join(" "),
        confidence: 0.95
      });
    }
  }

  // --------------------------------------------------
  // 4. Modifier detection
  // --------------------------------------------------

  for (const token of tokens) {
    if (MODIFIERS.has(token)) {
      entities.push({
        type: "modifier",
        value: token,
        confidence: 0.92
      });
    }
  }

  // --------------------------------------------------
  // 5. Preserve useful generic entities from winkNLP
  // --------------------------------------------------

  for (const entity of linguistic.entities) {
    // Friday is the name of our system.
    // Do not automatically treat it as a DATE.
    if (
      entity.type === "DATE" &&
      entity.value.toLowerCase() === "friday"
    ) {
      continue;
    }

    entities.push({
      type: entity.type.toLowerCase(),
      value: entity.value,
      confidence: 0.85
    });
  }

  // --------------------------------------------------
  // 6. Remove duplicate entities
  // --------------------------------------------------

  const unique = new Map<string, Entity>();

  for (const entity of entities) {
    const key = `${entity.type}:${entity.value.toLowerCase()}`;

    const existing = unique.get(key);

    if (!existing || entity.confidence > existing.confidence) {
      unique.set(key, entity);
    }
  }

  return Array.from(unique.values());
}