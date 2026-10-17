import fs from "node:fs/promises";
import path from "node:path";
import type {
  KnowledgeSnapshot,
  LearningEvent,
  RelationshipRecord,
} from "./types";

const SCHEMA_VERSION = 1;
const MAX_CONCEPTS = 1_000;
const MAX_SYMBOLS = 2_000;
const MAX_RELATIONSHIPS = 5_000;
const MAX_EVENTS = 2_000;
export const DEFAULT_KNOWLEDGE_STORE_PATH = path.join(
  process.cwd(),
  ".friday",
  "transinfant-memory.json",
);

export function emptyKnowledgeSnapshot(): KnowledgeSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    concepts: [],
    symbols: [],
    relationships: [],
    events: [],
  };
}

function validateSnapshot(value: unknown): KnowledgeSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    (value as KnowledgeSnapshot).schemaVersion !== SCHEMA_VERSION ||
    !Array.isArray((value as KnowledgeSnapshot).concepts) ||
    !Array.isArray((value as KnowledgeSnapshot).symbols) ||
    !Array.isArray((value as KnowledgeSnapshot).relationships) ||
    !Array.isArray((value as KnowledgeSnapshot).events)
  ) {
    throw new Error("Invalid TransInfant knowledge store or unsupported schema version.");
  }

  return value as KnowledgeSnapshot;
}

export class KnowledgeStore {
  private pendingWrites: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath = DEFAULT_KNOWLEDGE_STORE_PATH,
  ) {}

  getFilePath(): string {
    return this.filePath;
  }

  async read(): Promise<KnowledgeSnapshot> {
    let contents: string;

    try {
      contents = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyKnowledgeSnapshot();
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents) as unknown;
    } catch (error) {
      throw new Error(
        `Could not parse TransInfant knowledge store: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return validateSnapshot(parsed);
  }

  async update(
    updateSnapshot: (snapshot: KnowledgeSnapshot) => KnowledgeSnapshot,
  ): Promise<KnowledgeSnapshot> {
    let release!: () => void;
    const previousWrites = this.pendingWrites;
    this.pendingWrites = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousWrites;

    try {
      const current = await this.read();
      const updated = validateSnapshot(updateSnapshot(current));
      this.enforceBounds(updated);

      const directory = path.dirname(this.filePath);
      await fs.mkdir(directory, { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await fs.writeFile(
        temporaryPath,
        `${JSON.stringify(updated, null, 2)}\n`,
        "utf8",
      );
      await fs.rename(temporaryPath, this.filePath);

      return updated;
    } catch (error) {
      throw error;
    } finally {
      release();
    }
  }

  async reset(): Promise<void> {
    await this.update(() => emptyKnowledgeSnapshot());
  }

  private enforceBounds(snapshot: KnowledgeSnapshot): void {
    if (snapshot.concepts.length > MAX_CONCEPTS) {
      throw new Error(`TransInfant concept limit exceeded (${MAX_CONCEPTS}).`);
    }
    if (snapshot.symbols.length > MAX_SYMBOLS) {
      throw new Error(`TransInfant symbol limit exceeded (${MAX_SYMBOLS}).`);
    }
    if (snapshot.relationships.length > MAX_RELATIONSHIPS) {
      throw new Error(
        `TransInfant relationship limit exceeded (${MAX_RELATIONSHIPS}).`,
      );
    }

    snapshot.events = snapshot.events
      .slice(-MAX_EVENTS)
      .map((event: LearningEvent) => event);
    snapshot.relationships = snapshot.relationships
      .slice(-MAX_RELATIONSHIPS)
      .map((relationship: RelationshipRecord) => relationship);
  }
}

export const knowledgeStore = new KnowledgeStore();
