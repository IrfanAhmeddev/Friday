"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeStore = exports.KnowledgeStore = exports.DEFAULT_KNOWLEDGE_STORE_PATH = void 0;
exports.emptyKnowledgeSnapshot = emptyKnowledgeSnapshot;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const SCHEMA_VERSION = 1;
const MAX_CONCEPTS = 1_000;
const MAX_SYMBOLS = 2_000;
const MAX_RELATIONSHIPS = 5_000;
const MAX_EVENTS = 2_000;
exports.DEFAULT_KNOWLEDGE_STORE_PATH = node_path_1.default.join(process.cwd(), ".friday", "transinfant-memory.json");
function emptyKnowledgeSnapshot() {
    return {
        schemaVersion: SCHEMA_VERSION,
        concepts: [],
        symbols: [],
        relationships: [],
        events: [],
    };
}
function validateSnapshot(value) {
    if (!value ||
        typeof value !== "object" ||
        value.schemaVersion !== SCHEMA_VERSION ||
        !Array.isArray(value.concepts) ||
        !Array.isArray(value.symbols) ||
        !Array.isArray(value.relationships) ||
        !Array.isArray(value.events)) {
        throw new Error("Invalid TransInfant knowledge store or unsupported schema version.");
    }
    return value;
}
class KnowledgeStore {
    filePath;
    pendingWrites = Promise.resolve();
    constructor(filePath = exports.DEFAULT_KNOWLEDGE_STORE_PATH) {
        this.filePath = filePath;
    }
    getFilePath() {
        return this.filePath;
    }
    async read() {
        let contents;
        try {
            contents = await promises_1.default.readFile(this.filePath, "utf8");
        }
        catch (error) {
            if (error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ENOENT") {
                return emptyKnowledgeSnapshot();
            }
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(contents);
        }
        catch (error) {
            throw new Error(`Could not parse TransInfant knowledge store: ${error instanceof Error ? error.message : String(error)}`);
        }
        return validateSnapshot(parsed);
    }
    async update(updateSnapshot) {
        let release;
        const previousWrites = this.pendingWrites;
        this.pendingWrites = new Promise((resolve) => {
            release = resolve;
        });
        await previousWrites;
        try {
            const current = await this.read();
            const updated = validateSnapshot(updateSnapshot(current));
            this.enforceBounds(updated);
            const directory = node_path_1.default.dirname(this.filePath);
            await promises_1.default.mkdir(directory, { recursive: true });
            const temporaryPath = `${this.filePath}.tmp`;
            await promises_1.default.writeFile(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
            await promises_1.default.rename(temporaryPath, this.filePath);
            return updated;
        }
        catch (error) {
            throw error;
        }
        finally {
            release();
        }
    }
    async reset() {
        await this.update(() => emptyKnowledgeSnapshot());
    }
    enforceBounds(snapshot) {
        if (snapshot.concepts.length > MAX_CONCEPTS) {
            throw new Error(`TransInfant concept limit exceeded (${MAX_CONCEPTS}).`);
        }
        if (snapshot.symbols.length > MAX_SYMBOLS) {
            throw new Error(`TransInfant symbol limit exceeded (${MAX_SYMBOLS}).`);
        }
        if (snapshot.relationships.length > MAX_RELATIONSHIPS) {
            throw new Error(`TransInfant relationship limit exceeded (${MAX_RELATIONSHIPS}).`);
        }
        snapshot.events = snapshot.events
            .slice(-MAX_EVENTS)
            .map((event) => event);
        snapshot.relationships = snapshot.relationships
            .slice(-MAX_RELATIONSHIPS)
            .map((relationship) => relationship);
    }
}
exports.KnowledgeStore = KnowledgeStore;
exports.knowledgeStore = new KnowledgeStore();
