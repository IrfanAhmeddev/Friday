"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingEngine = exports.EmbeddingError = void 0;
exports.checkEmbeddingRuntime = checkEmbeddingRuntime;
exports.getEmbeddingModelStatus = getEmbeddingModelStatus;
exports.createEmbedding = createEmbedding;
const node_module_1 = require("node:module");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const moduleRequire = (0, node_module_1.createRequire)(__filename);
class EmbeddingError extends Error {
    code;
    originalError;
    constructor(code, message, originalError) {
        super(message);
        this.code = code;
        this.originalError = originalError;
        this.name = "EmbeddingError";
    }
}
exports.EmbeddingError = EmbeddingError;
function describeError(error, depth = 0) {
    if (!(error instanceof Error)) {
        return {
            name: typeof error,
            message: String(error),
            code: null,
            stack: null,
            cause: null,
        };
    }
    const errorWithCode = error;
    return {
        name: error.name,
        message: error.message,
        code: errorWithCode.code ?? null,
        stack: error.stack ?? null,
        cause: depth < 5 && error.cause !== undefined
            ? describeError(error.cause, depth + 1)
            : null,
    };
}
function logRuntimeFailure(component, error) {
    const details = describeError(error);
    console.error(JSON.stringify({
        level: "error",
        event: "embedding_runtime_check_failed",
        component,
        error: details,
    }));
    return {
        code: typeof details.code === "string" || typeof details.code === "number"
            ? details.code
            : null,
        message: details.message,
    };
}
function checkEmbeddingRuntime() {
    let sharp = "unavailable";
    let onnxRuntime = "unavailable";
    let sharpError;
    let onnxRuntimeError;
    try {
        const sharpModule = moduleRequire("sharp");
        if (sharpModule.versions) {
            sharp = "available";
        }
    }
    catch (error) {
        sharpError = logRuntimeFailure("sharp", error);
    }
    try {
        const runtime = moduleRequire("onnxruntime-node");
        if (typeof runtime.InferenceSession?.create === "function" &&
            typeof runtime.Tensor === "function") {
            onnxRuntime = "available";
        }
    }
    catch (error) {
        onnxRuntimeError = logRuntimeFailure("onnxruntime-node", error);
    }
    return {
        sharp,
        onnxRuntime,
        ...(sharpError ? { sharpError } : {}),
        ...(onnxRuntimeError ? { onnxRuntimeError } : {}),
    };
}
async function loadExtractor() {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = node_path_1.default.join((0, node_os_1.tmpdir)(), "friday-transformers-cache");
    const featureExtractor = await pipeline("feature-extraction", MODEL_NAME);
    return async (text, options) => {
        const output = await featureExtractor(text, options);
        return {
            data: output.data,
            dims: output.dims,
        };
    };
}
class EmbeddingEngine {
    loader;
    extractor = null;
    initialization = null;
    state = "cold";
    failureCode;
    constructor(loader = loadExtractor) {
        this.loader = loader;
    }
    getStatus() {
        return {
            state: this.state,
            ...(this.failureCode ? { failureCode: this.failureCode } : {}),
        };
    }
    async createEmbedding(text) {
        const normalized = text.trim();
        if (!normalized) {
            return [];
        }
        const extractor = await this.getExtractor();
        let output;
        try {
            output = await extractor(normalized, {
                pooling: "mean",
                normalize: true,
            });
        }
        catch (error) {
            throw new EmbeddingError("embedding_inference_failed", "Embedding inference failed.", error);
        }
        const values = [];
        for (const value of Array.from(output.data)) {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                throw new EmbeddingError("invalid_embedding", "The embedding model returned an invalid vector.");
            }
            values.push(value);
        }
        const shapeSize = output.dims.reduce((product, dimension) => Number.isInteger(dimension) && dimension > 0
            ? product * dimension
            : Number.NaN, 1);
        if (values.length === 0 || shapeSize !== values.length) {
            throw new EmbeddingError("invalid_embedding", "The embedding model returned an invalid vector.");
        }
        return values;
    }
    getExtractor() {
        if (this.extractor) {
            return Promise.resolve(this.extractor);
        }
        if (this.initialization) {
            return this.initialization;
        }
        this.state = "initializing";
        this.failureCode = undefined;
        let initialization;
        initialization = Promise.resolve()
            .then(() => this.loader())
            .then((extractor) => {
            this.extractor = extractor;
            this.state = "ready";
            return extractor;
        })
            .catch((error) => {
            this.state = "failed";
            this.failureCode = "model_initialization_failed";
            console.error(JSON.stringify({
                level: "error",
                event: "embedding_model_initialization_failed",
                error: describeError(error),
            }));
            throw new EmbeddingError("model_initialization_failed", "The embedding model could not be initialized.", error);
        })
            .finally(() => {
            if (this.initialization === initialization) {
                this.initialization = null;
            }
        });
        this.initialization = initialization;
        return initialization;
    }
}
exports.EmbeddingEngine = EmbeddingEngine;
const embeddingEngine = new EmbeddingEngine();
function getEmbeddingModelStatus() {
    return embeddingEngine.getStatus();
}
function createEmbedding(text) {
    return embeddingEngine.createEmbedding(text);
}
