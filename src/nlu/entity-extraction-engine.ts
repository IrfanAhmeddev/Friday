export type WorkspaceObject =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "note"
  | "file"
  | "report"
  | "project"
  | "application"
  | "unknown";

interface ObjectPattern {
  object: WorkspaceObject;
  patterns: string[];
  confidence: number;
}

export interface EntityExtractionResult {
  workspaceObject: WorkspaceObject;
  matchedText: string | null;
  confidence: number;
}

const OBJECT_PATTERNS: ObjectPattern[] = [
  {
    object: "application",
    patterns: [
      "application",
      "applications",
      "app",
      "apps",
    ],
    confidence: 0.98,
  },
  {
    object: "document",
    patterns: [
      "document",
      "documents",
      "doc",
      "docs",
    ],
    confidence: 0.98,
  },
  {
    object: "spreadsheet",
    patterns: [
      "spreadsheet",
      "spreadsheets",
      "sheet",
      "sheets",
    ],
    confidence: 0.98,
  },
  {
    object: "presentation",
    patterns: [
      "presentation",
      "presentations",
      "slide",
      "slides",
      "deck",
    ],
    confidence: 0.98,
  },
  {
    object: "note",
    patterns: [
      "note",
      "notes",
    ],
    confidence: 0.98,
  },
  {
    object: "report",
    patterns: [
      "report",
      "reports",
    ],
    confidence: 0.95,
  },
  {
    object: "file",
    patterns: [
      "file",
      "files",
    ],
    confidence: 0.95,
  },
  {
    object: "project",
    patterns: [
      "project",
      "projects",
    ],
    confidence: 0.95,
  },
];

export function extractWorkspaceObject(
  text: string,
): EntityExtractionResult {
  const normalizedText = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const objectPattern of OBJECT_PATTERNS) {
    for (const pattern of objectPattern.patterns) {
      const patternRegex = new RegExp(
        `\\b${pattern}\\b`,
        "i",
      );

      if (patternRegex.test(normalizedText)) {
        return {
          workspaceObject: objectPattern.object,
          matchedText: pattern,
          confidence: objectPattern.confidence,
        };
      }
    }
  }

  return {
    workspaceObject: "unknown",
    matchedText: null,
    confidence: 0,
  };
}