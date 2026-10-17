import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
const moduleRequire = createRequire(__filename);

export type EmbeddingErrorCode =
  | "model_initialization_failed"
  | "embedding_inference_failed"
  | "invalid_embedding";

export type EmbeddingModelState =
  | "cold"
  | "initializing"
  | "ready"
  | "failed";

export interface EmbeddingModelStatus {
  state: EmbeddingModelState;
  failureCode?: EmbeddingErrorCode;
}

interface EmbeddingOutput {
  data: ArrayLike<number | bigint>;
  dims: number[];
}

export type EmbeddingExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: true },
) => Promise<EmbeddingOutput>;

export class EmbeddingError extends Error {
  constructor(
    readonly code: EmbeddingErrorCode,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

interface ErrorDetails {
  name: string;
  message: string;
  code: unknown;
  stack: string | null;
  cause: ErrorDetails | null;
}

function describeError(
  error: unknown,
  depth = 0,
): ErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: String(error),
      code: null,
      stack: null,
      cause: null,
    };
  }

  const errorWithCode = error as Error & { code?: unknown };
  return {
    name: error.name,
    message: error.message,
    code: errorWithCode.code ?? null,
    stack: error.stack ?? null,
    cause:
      depth < 5 && error.cause !== undefined
        ? describeError(error.cause, depth + 1)
        : null,
  };
}

export interface EmbeddingRuntimeStatus {
  sharp: "available" | "unavailable";
  onnxRuntime: "available" | "unavailable";
}

export function checkEmbeddingRuntime(): EmbeddingRuntimeStatus {
  let sharp: EmbeddingRuntimeStatus["sharp"] = "unavailable";
  let onnxRuntime: EmbeddingRuntimeStatus["onnxRuntime"] =
    "unavailable";

  try {
    const sharpModule = moduleRequire("sharp") as (() => unknown) & {
      versions?: Record<string, string>;
    };
    if (sharpModule.versions) {
      sharp = "available";
    }
  } catch {
    sharp = "unavailable";
  }

  try {
    const runtime = moduleRequire("onnxruntime-node") as {
      InferenceSession?: { create?: unknown };
      Tensor?: unknown;
    };
    if (
      typeof runtime.InferenceSession?.create === "function" &&
      typeof runtime.Tensor === "function"
    ) {
      onnxRuntime = "available";
    }
  } catch {
    onnxRuntime = "unavailable";
  }

  return { sharp, onnxRuntime };
}

async function loadExtractor(): Promise<EmbeddingExtractor> {
  const { env, pipeline } =
    await import("@huggingface/transformers");

  env.cacheDir = path.join(tmpdir(), "friday-transformers-cache");

  const featureExtractor = await pipeline(
    "feature-extraction",
    MODEL_NAME,
  );

  return async (text, options) => {
    const output = await featureExtractor(text, options);
    return {
      data: output.data,
      dims: output.dims,
    };
  };
}

export class EmbeddingEngine {
  private extractor: EmbeddingExtractor | null = null;
  private initialization: Promise<EmbeddingExtractor> | null = null;
  private state: EmbeddingModelState = "cold";
  private failureCode: EmbeddingErrorCode | undefined;

  constructor(
    private readonly loader: () => Promise<EmbeddingExtractor> =
      loadExtractor,
  ) {}

  getStatus(): EmbeddingModelStatus {
    return {
      state: this.state,
      ...(this.failureCode ? { failureCode: this.failureCode } : {}),
    };
  }

  async createEmbedding(text: string): Promise<number[]> {
    const normalized = text.trim();

    if (!normalized) {
      return [];
    }

    const extractor = await this.getExtractor();
    let output: EmbeddingOutput;

    try {
      output = await extractor(normalized, {
        pooling: "mean",
        normalize: true,
      });
    } catch (error) {
      throw new EmbeddingError(
        "embedding_inference_failed",
        "Embedding inference failed.",
        error,
      );
    }

    const values: number[] = [];
    for (const value of Array.from(output.data)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new EmbeddingError(
          "invalid_embedding",
          "The embedding model returned an invalid vector.",
        );
      }
      values.push(value);
    }
    const shapeSize = output.dims.reduce(
      (product, dimension) =>
        Number.isInteger(dimension) && dimension > 0
          ? product * dimension
          : Number.NaN,
      1,
    );

    if (values.length === 0 || shapeSize !== values.length) {
      throw new EmbeddingError(
        "invalid_embedding",
        "The embedding model returned an invalid vector.",
      );
    }

    return values;
  }

  private getExtractor(): Promise<EmbeddingExtractor> {
    if (this.extractor) {
      return Promise.resolve(this.extractor);
    }

    if (this.initialization) {
      return this.initialization;
    }

    this.state = "initializing";
    this.failureCode = undefined;

    let initialization: Promise<EmbeddingExtractor>;
    initialization = Promise.resolve()
      .then(() => this.loader())
      .then((extractor) => {
        this.extractor = extractor;
        this.state = "ready";
        return extractor;
      })
      .catch((error: unknown) => {
        this.state = "failed";
        this.failureCode = "model_initialization_failed";
        console.error(
          JSON.stringify({
            level: "error",
            event: "embedding_model_initialization_failed",
            error: describeError(error),
          }),
        );
        throw new EmbeddingError(
          "model_initialization_failed",
          "The embedding model could not be initialized.",
          error,
        );
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

const embeddingEngine = new EmbeddingEngine();

export function getEmbeddingModelStatus(): EmbeddingModelStatus {
  return embeddingEngine.getStatus();
}

export function createEmbedding(text: string): Promise<number[]> {
  return embeddingEngine.createEmbedding(text);
}
