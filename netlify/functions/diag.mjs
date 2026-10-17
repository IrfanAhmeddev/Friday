import { timingSafeEqual } from "node:crypto";
import { readdir, stat, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_CACHE_DIR = path.join(
  tmpdir(),
  "friday-transformers-cache",
  MODEL_ID,
);

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

  return {
    name: error.name,
    message: error.message,
    code: error.code ?? null,
    stack: error.stack ?? null,
    cause:
      depth < 5 && error.cause !== undefined
        ? describeError(error.cause, depth + 1)
        : null,
  };
}

async function runStep(name, action) {
  try {
    return { status: "ok", result: await action() };
  } catch (error) {
    const details = describeError(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "netlify_diagnostic_step_failed",
        step: name,
        error: details,
      }),
    );
    return { status: "error", error: details };
  }
}

function authorized(event, expected) {
  const supplied =
    event.headers?.["x-diag-token"] ??
    event.headers?.["X-Diag-Token"] ??
    "";
  if (typeof supplied !== "string") {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

export const handler = async (event) => {
  try {
    const expectedToken = process.env.DIAG_TOKEN;
    if (!expectedToken) {
      return {
        statusCode: 503,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "diagnostic_not_configured" }),
      };
    }
    if (!authorized(event, expectedToken)) {
      return {
        statusCode: 401,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "unauthorized" }),
      };
    }

    const functionDirectory =
      typeof __dirname !== "undefined"
        ? __dirname
        : process.env.LAMBDA_TASK_ROOT;
    const steps = {};

    steps.runtime = await runStep("runtime", () => ({
      node: process.version,
      arch: process.arch,
      platform: process.platform,
      cwd: process.cwd(),
      lambdaTaskRoot: process.env.LAMBDA_TASK_ROOT ?? null,
      functionDirectory: functionDirectory ?? null,
    }));

    steps.sharp = await runStep("sharp", async () => {
      const sharpModule = await import("sharp");
      const sharp = sharpModule.default ?? sharpModule;
      return { versions: sharp.versions ?? null };
    });

    steps.onnxRuntime = await runStep("onnxruntime-node", async () => {
      const runtime = await import("onnxruntime-node");
      return {
        hasInferenceSessionCreate:
          typeof runtime.InferenceSession?.create === "function",
        hasTensor: typeof runtime.Tensor === "function",
      };
    });

    steps.modelDirectory = await runStep(
      "model-directory-listing",
      async () => ({
        path: MODEL_CACHE_DIR,
        entries: await readdir(MODEL_CACHE_DIR, { withFileTypes: true }).then(
          (entries) =>
            entries.map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? "directory" : "file",
            })),
        ),
      }),
    );

    steps.functionDirectory = await runStep(
      "function-directory-listing",
      async () => ({
        path: functionDirectory ?? null,
        entries: await readdir(functionDirectory),
      }),
    );

    steps.functionBundle = await runStep(
      "function-bundle-inspection",
      async () => {
        const requiredFunctionDirectory =
          "/var/task/friday/netlify/functions";
        const nodeModulesDirectories = [
          typeof functionDirectory === "string"
            ? path.join(functionDirectory, "node_modules")
            : null,
          typeof functionDirectory === "string"
            ? path.resolve(functionDirectory, "..", "..", "node_modules")
            : null,
          typeof process.env.LAMBDA_TASK_ROOT === "string"
            ? path.join(process.env.LAMBDA_TASK_ROOT, "node_modules")
            : null,
          path.resolve(process.cwd(), "node_modules"),
        ].filter((directory) => directory !== null);
        const uniqueNodeModulesDirectories = [
          ...new Set(nodeModulesDirectories),
        ];
        const packageNames = [
          "sharp",
          path.join("@img", "sharp-linux-x64"),
          path.join("@img", "sharp-libvips-linux-x64"),
          "onnxruntime-node",
        ];

        async function inspectDirectory(directory) {
          try {
            return {
              path: directory,
              exists: true,
              entries: await readdir(directory),
            };
          } catch (error) {
            if (error?.code === "ENOENT") {
              return { path: directory, exists: false, entries: [] };
            }
            return { path: directory, exists: null, error: describeError(error) };
          }
        }

        async function inspectPath(target) {
          try {
            const details = await stat(target);
            return {
              path: target,
              exists: true,
              type: details.isDirectory() ? "directory" : "file",
            };
          } catch (error) {
            if (error?.code === "ENOENT") {
              return { path: target, exists: false };
            }
            return { path: target, exists: null, error: describeError(error) };
          }
        }

        const nodeModules = await Promise.all(
          uniqueNodeModulesDirectories.map(async (directory) => ({
            directory: await inspectDirectory(directory),
            packages: await Promise.all(
              packageNames.map((packageName) =>
                inspectPath(path.join(directory, packageName)),
              ),
            ),
          })),
        );

        return {
          requiredFunctionDirectory: await inspectDirectory(
            requiredFunctionDirectory,
          ),
          functionDirectory:
            typeof functionDirectory === "string"
              ? await inspectDirectory(functionDirectory)
              : {
                  path: null,
                  exists: false,
                  error: "Function directory could not be resolved.",
                },
          nodeModules,
        };
      },
    );

    steps.tmpWrite = await runStep("tmp-write", async () => {
      const filePath = path.join(tmpdir(), `friday-diag-${process.pid}.tmp`);
      await writeFile(filePath, "ok", { flag: "w" });
      await unlink(filePath);
      return { path: filePath, writeAndCleanup: "ok" };
    });

    steps.embedding = await runStep("embedding-pipeline", async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(tmpdir(), "friday-transformers-cache");
      const extractor = await pipeline("feature-extraction", MODEL_ID);
      const output = await extractor("hi", {
        pooling: "mean",
        normalize: true,
      });
      return {
        model: MODEL_ID,
        dimensions: output.dims,
        vectorLength: output.data.length,
      };
    });

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(steps),
    };
  } catch (error) {
    const details = describeError(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "netlify_diagnostic_handler_failed",
        error: details,
      }),
    );
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: details }),
    };
  }
};
