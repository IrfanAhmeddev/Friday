"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const node_crypto_1 = require("node:crypto");
const express_1 = __importDefault(require("express"));
const embedding_engine_1 = require("../ml/embedding.engine");
const json_knowledge_engine_1 = require("../knowledge/json-knowledge-engine");
const friday_1 = require("../nlu/friday");
const MAX_BODY_BYTES = "32kb";
const MAX_TEXT_LENGTH = 4_000;
const MAX_SESSION_ID_LENGTH = 128;
const defaultDependencies = {
    understand: friday_1.understand,
    apiKey: process.env.FRIDAY_API_KEY,
    production: process.env.NODE_ENV === "production" ||
        process.env.CONTEXT === "production",
    loadKnowledge: json_knowledge_engine_1.loadJsonKnowledge,
};
function errorResponse(res, status, error, code, requestId) {
    res.status(status).json({ error, code, requestId });
}
function validBearerToken(authorization, expectedKey) {
    if (!authorization) {
        return false;
    }
    const match = /^Bearer ([^\s]+)$/.exec(authorization);
    if (!match) {
        return false;
    }
    const received = Buffer.from(match[1], "utf8");
    const expected = Buffer.from(expectedKey, "utf8");
    return (received.length === expected.length &&
        (0, node_crypto_1.timingSafeEqual)(received, expected));
}
function errorType(error) {
    if (error &&
        typeof error === "object" &&
        "type" in error &&
        typeof error.type === "string") {
        return error.type;
    }
    return undefined;
}
function statusCode(error) {
    if (error &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number") {
        return error.status;
    }
    return undefined;
}
function readinessErrorDetails(error, depth = 0) {
    if (!(error instanceof Error)) {
        return {
            name: typeof error,
            message: String(error),
            code: null,
            stack: null,
            cause: null,
        };
    }
    const errorCode = "code" in error &&
        (typeof error.code === "string" || typeof error.code === "number")
        ? error.code
        : null;
    return {
        name: error.name,
        message: error.message,
        code: errorCode,
        stack: error.stack ?? null,
        cause: error.cause === undefined
            ? null
            : error.cause instanceof Error
                ? depth < 5
                    ? readinessErrorDetails(error.cause, depth + 1)
                    : null
                : String(error.cause),
    };
}
function createApp(overrides = {}) {
    const dependencies = {
        ...defaultDependencies,
        ...overrides,
    };
    const app = (0, express_1.default)();
    app.use((req, res, next) => {
        const requestId = (0, node_crypto_1.randomUUID)();
        const startedAt = performance.now();
        res.locals.requestId = requestId;
        res.setHeader("X-Request-ID", requestId);
        res.on("finish", () => {
            console.info(JSON.stringify({
                level: "info",
                event: "http_request_complete",
                requestId,
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                durationMs: Math.round(performance.now() - startedAt),
            }));
        });
        next();
    });
    app.use(express_1.default.json({ limit: MAX_BODY_BYTES }));
    const authenticateRequest = (req, res, next) => {
        const requestId = res.locals.requestId;
        if (!dependencies.apiKey) {
            if (dependencies.production) {
                errorResponse(res, 503, "service unavailable", "authentication_not_configured", requestId);
                return;
            }
            next();
            return;
        }
        if (!validBearerToken(req.headers.authorization, dependencies.apiKey)) {
            errorResponse(res, 401, req.headers.authorization
                ? "invalid authorization"
                : "authorization required", "unauthorized", requestId);
            return;
        }
        next();
    };
    const healthHandler = (_req, res) => {
        res.json({
            status: "ok",
            service: "friday",
            version: "0.1.0",
        });
    };
    const readinessHandler = (_req, res) => {
        let knowledge = "available";
        let knowledgeError;
        try {
            dependencies.loadKnowledge();
        }
        catch (error) {
            knowledge = "unavailable";
            const details = readinessErrorDetails(error);
            knowledgeError = { code: details.code };
            console.error(JSON.stringify({
                level: "error",
                event: "readiness_knowledge_check_failed",
                error: details,
            }));
        }
        const runtime = (0, embedding_engine_1.checkEmbeddingRuntime)();
        const model = (0, embedding_engine_1.getEmbeddingModelStatus)();
        const ready = knowledge === "available" &&
            runtime.sharp === "available" &&
            runtime.onnxRuntime === "available" &&
            model.state === "ready";
        res.status(ready ? 200 : 503).json({
            status: ready ? "ready" : "not_ready",
            service: "friday",
            version: "0.1.0",
            components: {
                knowledge,
                sharp: runtime.sharp,
                onnxRuntime: runtime.onnxRuntime,
                embeddingModel: model.state,
            },
            diagnostics: {
                knowledge: knowledgeError
                    ? {
                        code: knowledgeError.code,
                        message: "Knowledge data could not be loaded.",
                    }
                    : null,
                sharp: runtime.sharpError ?? null,
                onnxRuntime: runtime.onnxRuntimeError ?? null,
                embeddingModel: model.state === "failed"
                    ? {
                        code: model.failureCode ?? null,
                        message: "The embedding model could not be initialized.",
                    }
                    : null,
            },
        });
    };
    app.get(["/health", "/api/health"], healthHandler);
    app.get(["/ready", "/api/ready"], readinessHandler);
    const understandHandler = async (req, res) => {
        const requestId = res.locals.requestId;
        const body = req.body;
        if (!body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            typeof body.text !== "string" ||
            body.text.trim().length === 0) {
            errorResponse(res, 400, "text is required", "invalid_request", requestId);
            return;
        }
        if (body.text.length > MAX_TEXT_LENGTH) {
            errorResponse(res, 413, "text exceeds the maximum length", "text_too_long", requestId);
            return;
        }
        if (body.sessionId !== undefined &&
            typeof body.sessionId !== "string") {
            errorResponse(res, 400, "sessionId must be a string", "invalid_session_id", requestId);
            return;
        }
        const sessionId = body.sessionId?.trim() || "default";
        if (sessionId.length > MAX_SESSION_ID_LENGTH) {
            errorResponse(res, 400, "sessionId exceeds the maximum length", "invalid_session_id", requestId);
            return;
        }
        try {
            const result = await dependencies.understand(body.text, sessionId);
            res.json({
                apiVersion: "1",
                service: "friday",
                ...result,
            });
        }
        catch (error) {
            const isEmbeddingError = error instanceof embedding_engine_1.EmbeddingError;
            console.error(JSON.stringify({
                level: "error",
                event: "nlu_request_failed",
                requestId,
                code: isEmbeddingError ? error.code : "nlu_processing_failed",
                error: error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
            }));
            const unavailable = isEmbeddingError &&
                error.code === "model_initialization_failed";
            errorResponse(res, unavailable ? 503 : 500, unavailable
                ? "language model temporarily unavailable"
                : "failed to understand input", unavailable ? "model_unavailable" : "nlu_processing_failed", requestId);
        }
    };
    app.post(["/understand", "/api/understand"], authenticateRequest, understandHandler);
    app.use((req, res) => {
        errorResponse(res, 404, "not found", "not_found", res.locals.requestId);
    });
    app.use((error, req, res, next) => {
        if (res.headersSent) {
            next(error);
            return;
        }
        const requestId = res.locals.requestId;
        const type = errorType(error);
        const parserStatus = statusCode(error);
        const status = type === "entity.too.large"
            ? 413
            : type === "entity.parse.failed"
                ? 400
                : parserStatus && parserStatus >= 400
                    ? parserStatus
                    : 500;
        const code = type === "entity.too.large"
            ? "payload_too_large"
            : type === "entity.parse.failed"
                ? "invalid_json"
                : "request_failed";
        if (status >= 500) {
            console.error(JSON.stringify({
                level: "error",
                event: "http_request_failed",
                requestId,
                method: req.method,
                path: req.path,
                error: error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : String(error),
            }));
        }
        errorResponse(res, status, status === 413
            ? "request body is too large"
            : status === 400
                ? "invalid request body"
                : "request failed", code, requestId);
    });
    return app;
}
const app = createApp();
exports.default = app;
