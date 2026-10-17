const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const onnxBinDirectory = path.join(
  projectRoot,
  "node_modules",
  "onnxruntime-node",
  "bin",
);
const imagePackageDirectory = path.join(
  projectRoot,
  "node_modules",
  "@img",
);

function removeOtherEntries(parentDirectory, keepName) {
  if (!fs.existsSync(parentDirectory)) {
    throw new Error(
      `Required native dependency directory is missing: ${parentDirectory}`,
    );
  }

  for (const entry of fs.readdirSync(parentDirectory, {
    withFileTypes: true,
  })) {
    if (entry.name === keepName) {
      continue;
    }

    fs.rmSync(path.join(parentDirectory, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

function pruneNetlifyRuntime() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      `Netlify function packaging requires Linux x64; got ${process.platform}/${process.arch}.`,
    );
  }

  const napiDirectories = fs
    .readdirSync(onnxBinDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^napi-v\d+$/.test(entry.name))
    .map((entry) => entry.name);
  if (!napiDirectories.includes("napi-v6")) {
    throw new Error(
      "onnxruntime-node does not contain the expected napi-v6 runtime.",
    );
  }

  for (const napiDirectory of napiDirectories) {
    const napiPath = path.join(onnxBinDirectory, napiDirectory);
    if (napiDirectory !== "napi-v6") {
      fs.rmSync(napiPath, { recursive: true, force: true });
      continue;
    }

    removeOtherEntries(napiPath, "linux");
    const linuxDirectory = path.join(napiPath, "linux");
    removeOtherEntries(linuxDirectory, "x64");

    const x64Directory = path.join(linuxDirectory, "x64");
    for (const entry of fs.readdirSync(x64Directory, {
      withFileTypes: true,
    })) {
      if (
        entry.isFile() &&
        /^libonnxruntime_providers_(?:cuda|tensorrt)\.so(?:\.\d+)*$/i.test(
          entry.name,
        )
      ) {
        fs.rmSync(path.join(x64Directory, entry.name), { force: true });
      }
    }

    for (const requiredFile of [
      "onnxruntime_binding.node",
      "libonnxruntime.so.1",
      "libonnxruntime_providers_shared.so",
    ]) {
      if (!fs.existsSync(path.join(x64Directory, requiredFile))) {
        throw new Error(
          `Required ONNX Runtime CPU file is missing after pruning: ${requiredFile}`,
        );
      }
    }
  }

  for (const entry of fs.readdirSync(imagePackageDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || !entry.name.startsWith("sharp-")) {
      continue;
    }
    if (
      entry.name === "sharp-linux-x64" ||
      entry.name === "sharp-libvips-linux-x64"
    ) {
      continue;
    }
    fs.rmSync(path.join(imagePackageDirectory, entry.name), {
      recursive: true,
      force: true,
    });
  }

  const requiredSharpFiles = [
    path.join(
      imagePackageDirectory,
      "sharp-linux-x64",
      "lib",
      "sharp-linux-x64.node",
    ),
    path.join(
      imagePackageDirectory,
      "sharp-libvips-linux-x64",
      "lib",
      "index.js",
    ),
  ];
  for (const requiredFile of requiredSharpFiles) {
    if (!fs.existsSync(requiredFile)) {
      throw new Error(
        `Required Linux x64 Sharp file is missing after pruning: ${requiredFile}`,
      );
    }
  }

  console.log(
    "Pruned function runtime payload to Linux x64 CPU ONNX Runtime and glibc Sharp.",
  );
}

if (require.main === module) {
  try {
    pruneNetlifyRuntime();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { pruneNetlifyRuntime };
