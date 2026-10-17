# FRIDAY API operations

## Runtime behavior

The Netlify function uses MiniLM through Transformers and ONNX Runtime. The first
request requiring semantic scoring may download model files from Hugging Face.
They are cached under the operating system temporary directory for the lifetime
of a function instance; that cache is not shared across instances or guaranteed
to survive a deployment. Cold starts therefore require outbound access to the
model host and enough function execution time and memory for the download and
initialization.

Conversation sessions are process-local and limited to the 1,000 most recently
used sessions per warm instance. Their history is not durable and is not shared
between function instances. Use a durable external store before relying on
cross-instance conversational continuity.

## Deployment checks

Build from the project root using Node.js 22 on Linux x64. Netlify's supported
`NPM_FLAGS` setting passes `--include=optional` to its dependency install
command. The Netlify build command prunes ONNX Runtime to its Linux x64 CPU
files, removes optional CUDA/TensorRT and non-target platform binaries, and
retains Sharp's Linux glibc packages. The packaging check fails if the API
archive reaches 45 MiB compressed or 200 MiB expanded, lacks a required native
binary, contains a non-Linux runtime, or includes a function other than `api`.

The site publishes only the small `public/` directory; API routes are still
handled by the `/api/*` function redirect. The temporary diagnostic function
must not be restored to `netlify/functions` or included in deploys.

The four JSON knowledge files are statically required by the knowledge engine,
so esbuild embeds their data directly into the function bundle; runtime
knowledge loading does not depend on loose files or a working directory. The
local Netlify build plugin verifies the required JSON data is present in the
bundled function archive. Run the same artifact check manually with
`npm run verify:netlify-assets` after a Netlify build.

The Netlify packaging command intentionally stops on Windows or non-x64
systems. Use Netlify's Linux Git build environment (or matching Linux x64 CI)
to build and verify the function; do not deploy a Windows-generated function
archive or promote a Windows build as proof of Linux compatibility.

## Reproducible NLU evaluation

Run `npm run benchmark:friday` to evaluate the fixed 19-case
[`intent-v1.json`](./research/friday/datasets/intent-v1.json) fixture against
the real MiniLM-backed FRIDAY path with TransInfant disabled. It reports intent
accuracy/macro-F1, semantic action/object accuracy, exact intent-action-object
match, workspace-object entity precision/recall/F1, ambiguity and clarification
recall, negative-command abstention, and cold/warm latency. It exits nonzero if
the smoke thresholds fail. The cases are a small, hand-authored regression
fixture, not a statistically representative or broad held-out language
benchmark; run on the target runtime and keep the dataset version/hash with
any reported results. Confidence calibration is not measured.

`npm run benchmark:transinfant:005` runs the separate synthetic, held-out
TransInfant incremental-composition experiment. Its narrow scope, controls,
dataset hashes, and limitations are documented in
[`EXPERIMENT-005.md`](./research/transinfant/EXPERIMENT-005.md).

## Health and safe API checks

Liveness does not load the model:

```powershell
curl.exe -i https://<site-host>/api/health
```

Readiness checks the JSON knowledge assets and local native runtimes. It
returns HTTP 503 until the JSON knowledge, ONNX Runtime, and embedding model
required by workspace semantic scoring are available; a cold model is reported
as cold. Sharp is reported as an optional image-processing component and does
not block readiness for FRIDAY's text-only NLU path. The check does not
download model files or prove outbound model-host connectivity:

```powershell
curl.exe -i https://<site-host>/api/ready
```

Send a minimal authenticated request without putting a key in source control or
shell history:

```powershell
curl.exe -i -X POST https://<site-host>/api/understand `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer <FRIDAY_API_KEY>" `
  --data-binary '{"text":"open the report","sessionId":"android-smoke-test"}'
```

`/api/understand` preserves the JSON response contract (`apiVersion`, `service`,
`status`, `intent`, `semantic`, `reference`, `entities`, and `context`). Requests
are limited to 32 KiB, text to 4,000 characters, and session IDs to 128
characters. It adds an `intelligence` field with the versioned v1 projection;
legacy response fields remain unchanged. Confidence is explicitly marked as a
heuristic, and task planning is reported as not proposed until a separate
planner is implemented. The API key is required for deployed production
context; missing production configuration fails closed. Native Android HTTP
clients do not need CORS. A browser or Android WebView client would need an
explicitly scoped CORS policy before cross-origin requests are enabled.

## Troubleshooting and rollback

1. Check `/api/health`, then `/api/ready`, and correlate function logs using the
   `X-Request-ID` response header.
2. For native runtime failures, verify the final Linux function package contains
   `@img/sharp-linux-x64`, `@img/sharp-libvips-linux-x64`, and ONNX Runtime's
   Linux x64 native binary. Repeat this check after dependency or bundler
   changes.
3. For model initialization failures, verify outbound access to Hugging Face,
   the deployment's function timeout/memory allocation, and the model status in
   readiness. A local Windows success does not verify the deployed Linux
   runtime.
4. If knowledge loading fails, confirm the function bundle contains the
   embedded contents of all four source JSON assets. A successful Netlify
   build prints the packaged asset verification result; locally, run
   `npm run verify:netlify-assets`.
5. If the new deployment is unhealthy, roll back to the last known-good Netlify
   deploy and diagnose in a non-production deploy context. Do not weaken API
   authentication or expose the API key during diagnosis.
