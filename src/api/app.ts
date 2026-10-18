import { randomUUID, timingSafeEqual } from "node:crypto";
import express, {
  NextFunction,
  Request,
  Response,
} from "express";

import {
  checkEmbeddingRuntime,
  EmbeddingError,
  getEmbeddingModelStatus,
  initializeEmbeddingModel,
} from "../ml/embedding.engine";
import {
  loadJsonKnowledge,
} from "../knowledge/json-knowledge-engine";
import { understand } from "../nlu/friday";
import { NLURequest, NLUResult } from "../types/nlu";
import { createIntelligenceContract } from "../types/intelligence-contract";
import { errorDetails } from "../error-details";

const MAX_BODY_BYTES = "32kb";
const MAX_TEXT_LENGTH = 4_000;
const MAX_SESSION_ID_LENGTH = 128;

type UnderstandFunction = (
  text: string,
  sessionId: string,
) => Promise<NLUResult>;

export interface ApiDependencies {
  understand: UnderstandFunction;
  apiKey: string | undefined;
  production: boolean;
  loadKnowledge: () => unknown;
  checkRuntime: typeof checkEmbeddingRuntime;
  getModelStatus: typeof getEmbeddingModelStatus;
  initializeModel: typeof initializeEmbeddingModel;
}

const defaultDependencies: ApiDependencies = {
  understand,
  apiKey: process.env.FRIDAY_API_KEY,
  production:
    process.env.NODE_ENV === "production" ||
    process.env.CONTEXT === "production",
  loadKnowledge: loadJsonKnowledge,
  checkRuntime: checkEmbeddingRuntime,
  getModelStatus: getEmbeddingModelStatus,
  initializeModel: initializeEmbeddingModel,
};

function errorResponse(
  res: Response,
  status: number,
  error: string,
  code: string,
  requestId: string,
): void {
  res.status(status).json({ error, code, requestId });
}

function validBearerToken(
  authorization: string | undefined,
  expectedKey: string,
): boolean {
  if (!authorization) {
    return false;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) {
    return false;
  }

  const received = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(expectedKey, "utf8");

  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

function errorType(error: unknown): string | undefined {
  if (
    error &&
    typeof error === "object" &&
    "type" in error &&
    typeof error.type === "string"
  ) {
    return error.type;
  }
  return undefined;
}

function statusCode(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

export function createApp(
  overrides: Partial<ApiDependencies> = {},
) {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };
  const app = express();

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    res.on("finish", () => {
      console.info(
        JSON.stringify({
          level: "info",
          event: "http_request_complete",
          requestId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Math.round(performance.now() - startedAt),
        }),
      );
    });
    next();
  });

  app.use(express.json({ limit: MAX_BODY_BYTES }));

  const authenticateRequest = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const requestId = res.locals.requestId as string;

    if (!dependencies.apiKey) {
      if (dependencies.production) {
        errorResponse(
          res,
          503,
          "service unavailable",
          "authentication_not_configured",
          requestId,
        );
        return;
      }

      next();
      return;
    }

    if (!validBearerToken(req.headers.authorization, dependencies.apiKey)) {
      errorResponse(
        res,
        401,
        req.headers.authorization
          ? "invalid authorization"
          : "authorization required",
        "unauthorized",
        requestId,
      );
      return;
    }

    next();
  };

  const healthHandler = (_req: Request, res: Response): void => {
    res.json({
      status: "ok",
      service: "friday",
      version: "0.1.0",
    });
  };

  const readinessHandler = async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    const requestId = res.locals.requestId as string;
    let knowledge = "available";
    let knowledgeError: { code: string | number | null } | undefined;
    try {
      dependencies.loadKnowledge();
    } catch (error) {
      knowledge = "unavailable";
      const details = errorDetails(error);
      knowledgeError = { code: details.code };
      console.error(
        JSON.stringify({
          level: "error",
          event: "readiness_knowledge_check_failed",
          error: details,
        }),
      );
    }

    try {
      await dependencies.initializeModel();
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "readiness_model_initialization_failed",
          requestId,
          error: errorDetails(error),
        }),
      );
    }

    const runtime = dependencies.checkRuntime();
    const model = dependencies.getModelStatus();
    const ready =
      knowledge === "available" &&
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
      optionalComponents: {
        sharp: runtime.sharp,
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
        embeddingModel:
          model.state === "failed"
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

  const understandHandler = async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const requestId = res.locals.requestId as string;
    const body = req.body as Partial<NLURequest> | undefined;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      typeof body.text !== "string" ||
      body.text.trim().length === 0
    ) {
      errorResponse(
        res,
        400,
        "text is required",
        "invalid_request",
        requestId,
      );
      return;
    }

    if (body.text.length > MAX_TEXT_LENGTH) {
      errorResponse(
        res,
        413,
        "text exceeds the maximum length",
        "text_too_long",
        requestId,
      );
      return;
    }

    if (
      body.sessionId !== undefined &&
      typeof body.sessionId !== "string"
    ) {
      errorResponse(
        res,
        400,
        "sessionId must be a string",
        "invalid_session_id",
        requestId,
      );
      return;
    }

    const sessionId = body.sessionId?.trim() || "default";
    if (sessionId.length > MAX_SESSION_ID_LENGTH) {
      errorResponse(
        res,
        400,
        "sessionId exceeds the maximum length",
        "invalid_session_id",
        requestId,
      );
      return;
    }

    try {
      const result = await dependencies.understand(
        body.text,
        sessionId,
      );

      res.json({
        apiVersion: "1",
        service: "friday",
        ...result,
        intelligence: createIntelligenceContract(body.text, result, sessionId),
      });
    } catch (error) {
      const isEmbeddingError = error instanceof EmbeddingError;
      const details = errorDetails(error);
      console.error(
        JSON.stringify({
          level: "error",
          event: "nlu_request_failed",
          requestId,
          code: isEmbeddingError ? error.code : "nlu_processing_failed",
          error: details,
        }),
      );

      const unavailable =
        isEmbeddingError &&
        error.code === "model_initialization_failed";
      errorResponse(
        res,
        unavailable ? 503 : 500,
        unavailable
          ? "language model temporarily unavailable"
          : "failed to understand input",
        unavailable ? "model_unavailable" : "nlu_processing_failed",
        requestId,
      );
    }
  };

  app.post(
    ["/understand", "/api/understand"],
    authenticateRequest,
    understandHandler,
  );

  app.use((req, res) => {
    errorResponse(
      res,
      404,
      "not found",
      "not_found",
      res.locals.requestId as string,
    );
  });

  app.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }

      const requestId = res.locals.requestId as string;
      const type = errorType(error);
      const parserStatus = statusCode(error);
      const status =
        type === "entity.too.large"
          ? 413
          : type === "entity.parse.failed"
            ? 400
            : parserStatus && parserStatus >= 400
              ? parserStatus
              : 500;
      const code =
        type === "entity.too.large"
          ? "payload_too_large"
          : type === "entity.parse.failed"
            ? "invalid_json"
            : "request_failed";

      if (status >= 500) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "http_request_failed",
            requestId,
            method: req.method,
            path: req.path,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          }),
        );
      }

      errorResponse(
        res,
        status,
        status === 413
          ? "request body is too large"
          : status === 400
            ? "invalid request body"
            : "request failed",
        code,
        requestId,
      );
    },
  );

  return app;
}

const app = createApp();

export default app;
