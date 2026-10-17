export type RelationshipSource = "explicit" | "feedback" | "inferred";
export type RelationshipStatus =
  | "accepted"
  | "candidate"
  | "rejected"
  | "superseded";

export interface LearningEntity {
  id: string;
  label: string;
  aliases?: string[];
  attributes?: Record<string, string>;
}

export interface LearningRelationship {
  subject: string;
  predicate: string;
  object: string;
  source: RelationshipSource;
  confidence?: number;
}

export interface LearningExperience {
  id: string;
  source: string;
  timestamp?: string;
  entities: LearningEntity[];
  relationships: LearningRelationship[];
}

export interface ConceptRecord {
  id: string;
  label: string;
  attributes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface SymbolRecord {
  normalized: string;
  conceptId: string;
  surface: string;
}

export interface RelationshipRecord extends LearningRelationship {
  id: string;
  experienceId: string;
  status: RelationshipStatus;
  confidence: number;
  timestamp: string;
}

export interface LearningEvent {
  id: string;
  timestamp: string;
  experienceId: string;
  source: string;
  outcome: "accepted" | "partial" | "rejected" | "reverted";
  details: string[];
  addedConceptIds: string[];
  addedSymbolKeys: string[];
  addedRelationshipIds: string[];
  supersededRelationshipIds: string[];
}

export interface KnowledgeSnapshot {
  schemaVersion: 1;
  concepts: ConceptRecord[];
  symbols: SymbolRecord[];
  relationships: RelationshipRecord[];
  events: LearningEvent[];
}

export interface LearningResult {
  accepted: boolean;
  experienceId: string;
  acceptedRelationshipIds: string[];
  candidateRelationshipIds: string[];
  rejectedRelationshipIds: string[];
  details: string[];
}

export interface SemanticInterpretationCandidate {
  action: string | null;
  object: string | null;
  confidence: number;
  evidence: string[];
  source: "transinfant";
}
