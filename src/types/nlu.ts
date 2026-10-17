export interface NLURequest {
  text: string;
  sessionId?: string;
}

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start?: number;
  end?: number;
}

export interface IntentResult {
  name: string;
  confidence: number;
}

export type SemanticAction =
  | "create"
  | "open"
  | "search"
  | "show"
  | "delete"
  | "remove"
  | "rename"
  | "edit"
  | "close"
  | "unknown";

export type SemanticObject =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "note"
  | "file"
  | "folder"
  | "application"
  | "report"
  | "project"
  | "unknown";

export interface SemanticResult {
  action: SemanticAction;
  object: SemanticObject;
  confidence: number;
  matchedWords: string[];
}

export interface ReferenceResult {
  hasReference: boolean;

  reference:
    | "previous"
    | "current"
    | "unknown";

  referencedObject:
    | SemanticObject
    | "unknown";

  referencedName: string | null;

  matchedWords: string[];

  confidence: number;
}

export interface Command {
  action: string;
  parameters: Record<string, unknown>;
}

export interface NLUResult {
  status: "understood" | "uncertain" | "unknown";

  intent: IntentResult;

  semantic: SemanticResult;

  reference: ReferenceResult;

  entities: Entity[];

  context: Record<string, unknown>;

  command?: Command;
}