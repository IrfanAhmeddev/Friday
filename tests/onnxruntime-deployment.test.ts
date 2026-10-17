import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(__filename);

test("Netlify externalizes the exact ONNX runtime required by Transformers", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
  };
  const packageLock = JSON.parse(
    readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
  ) as {
    packages: Record<string, {
      dependencies?: Record<string, string>;
    }>;
  };
  const transformersPackage =
    packageLock.packages["node_modules/@huggingface/transformers"];
  const netlifyConfig = readFileSync(
    path.join(process.cwd(), "netlify.toml"),
    "utf8",
  );

  assert.equal(
    packageJson.dependencies["onnxruntime-node"],
    transformersPackage?.dependencies?.["onnxruntime-node"],
  );
  assert.match(netlifyConfig, /external_node_modules\s*=\s*\[[^\]]*"onnxruntime-node"/);
});

test("the installed ONNX runtime can load its native backend", () => {
  const runtime = require("onnxruntime-node") as {
    InferenceSession?: { create?: unknown };
    Tensor?: unknown;
  };

  assert.equal(typeof runtime.InferenceSession?.create, "function");
  assert.equal(typeof runtime.Tensor, "function");
});
