import { Entity } from "../types/nlu";

export function extractConversationalEntities(
  text: string
): Entity[] {
  const normalized = text
    .trim()
    .replace(/\s+/g, " ");

  const entities: Entity[] = [];

  const patterns = [
    /^call (?:it|that|this|one) (.+)$/i,

    /^rename (?:it|that|this|one) to (.+)$/i,

    /^change (?:its|the) name to (.+)$/i,

    /^change (?:it|that|this|one)'s name to (.+)$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (!match) {
      continue;
    }

    const newName = match[1]
      .trim()
      .replace(/[.!?]+$/, "")
      .trim();

    if (!newName) {
      continue;
    }

    entities.push({
      type: "new_name",
      value: newName,
      confidence: 0.95
    });

    break;
  }

  return entities;
}