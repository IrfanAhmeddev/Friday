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

Build from the project root using Node.js 22. Netlify's supported `NPM_FLAGS`
setting passes `--include=optional` to its dependency install command. The Linux
x64 sharp and libvips packages are declared as optional root dependencies so a
Linux deployment install resolves their native binaries.
The four JSON knowledge files are statically required by the knowledge engine,
so esbuild embeds their data directly into the function bundle; runtime
knowledge loading does not depend on loose files or a working directory. The
local Netlify build plugin verifies the required JSON data is present in the
bundled function archive. Run the same artifact check manually with
`npm run verify:netlify-assets` after a Netlify build.

On Windows, a local Netlify build cannot validate Linux native module loading.
Use Netlify's Linux build environment (or a matching Linux x64 CI job) to verify
that `sharp` and `onnxruntime-node` load from the final function package. Do not
promote a Windows-generated function archive as proof of Linux compatibility.

## Health and safe API checks

Liveness does not load the model:

```powershell
curl.exe -i https://<site-host>/api/health
```

Readiness checks the JSON knowledge assets and local native runtimes. It
returns HTTP 503 until the embedding model has loaded successfully; a cold
model is reported as cold. The check does not download model files or prove
outbound model-host connectivity:

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
characters. The API key is required for deployed production context; missing
production configuration fails closed. Native Android HTTP clients do not need
CORS. A browser or Android WebView client would need an explicitly scoped CORS
policy before cross-origin requests are enabled.

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
