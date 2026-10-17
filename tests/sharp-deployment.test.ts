import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const require = createRequire(__filename);

test("Netlify packages the Linux x64 sharp runtime required by Transformers", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
  };
  const packageLock = JSON.parse(
    readFileSync(path.join(process.cwd(), "package-lock.json"), "utf8"),
  ) as {
    packages: Record<string, {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }>;
  };
  const netlifyConfig = readFileSync(
    path.join(process.cwd(), "netlify.toml"),
    "utf8",
  );

  const transformers = packageLock.packages[
    "node_modules/@huggingface/transformers"
  ];
  const sharp = packageLock.packages["node_modules/sharp"];
  const rootDependencies = packageLock.packages[""];

  assert.equal(sharp?.version, packageJson.dependencies.sharp);
  assert.equal(transformers?.dependencies?.sharp, `^${sharp?.version}`);
  assert.equal(
    sharp?.optionalDependencies?.["@img/sharp-linux-x64"],
    "0.34.5",
  );
  assert.equal(
    sharp?.optionalDependencies?.["@img/sharp-libvips-linux-x64"],
    "1.2.4",
  );
  assert.equal(
    packageJson.optionalDependencies["@img/sharp-linux-x64"],
    "0.34.5",
  );
  assert.equal(
    packageJson.optionalDependencies["@img/sharp-libvips-linux-x64"],
    "1.2.4",
  );
  assert.equal(
    rootDependencies?.optionalDependencies?.["@img/sharp-linux-x64"],
    "0.34.5",
  );
  assert.equal(
    rootDependencies?.optionalDependencies?.["@img/sharp-libvips-linux-x64"],
    "1.2.4",
  );
  assert.match(
    netlifyConfig,
    /external_node_modules\s*=\s*\[[^\]]*"sharp"/,
  );
  assert.match(
    netlifyConfig,
    /\[build\.environment\][\s\S]*?NODE_VERSION\s*=\s*"22"/,
  );
  assert.match(
    netlifyConfig,
    /\[build\.environment\][\s\S]*?NPM_FLAGS\s*=\s*"--include=optional"/,
  );
  assert.match(netlifyConfig, /node_modules\/@img\/sharp-linux-x64\/\*\*/);
  assert.match(netlifyConfig, /node_modules\/@img\/sharp-libvips-linux-x64\/\*\*/);
  assert.doesNotMatch(netlifyConfig, /data\/\*\.json/);
});

test("the installed sharp native runtime performs an image operation", async () => {
  const sharp = require("sharp") as typeof import("sharp");
  const output = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer();

  assert.ok(output.length > 0);
});
