const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const requiredAssetNames = [
  "entities.json",
  "patterns.json",
  "synonyms.json",
  "vocabulary.json",
];
const maximumFunctionArchiveBytes = 45 * 1024 * 1024;
const maximumFunctionUncompressedBytes = 200 * 1024 * 1024;
const requiredRuntimeEntries = [
  "node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node",
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1",
  "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_shared.so",
];

function collectStringValues(value, collected = new Set()) {
  if (typeof value === "string") {
    collected.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, collected);
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, collected);
    }
  }

  return collected;
}

function collectPropertyNames(value, collected = new Set()) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPropertyNames(entry, collected);
    }
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collected.add(key);
      collectPropertyNames(entry, collected);
    }
  }

  return collected;
}

function includesBundledProperty(bundle, propertyName) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:${JSON.stringify(propertyName)}|\\b${escaped}\\b)\\s*:`).test(
    bundle,
  );
}

function zipEntries(zipPath, requiredAssets = []) {
  const archive = fs.readFileSync(zipPath);
  const minimumEocdLength = 22;
  const maxCommentLength = 0xffff;
  const searchStart = Math.max(
    0,
    archive.length - minimumEocdLength - maxCommentLength,
  );
  let eocdOffset = -1;

  for (let offset = archive.length - minimumEocdLength; offset >= searchStart; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("Function archive has no valid ZIP directory.");
  }

  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  let entryOffset = archive.readUInt32LE(eocdOffset + 16);
  const names = new Set();
  const contents = new Map();
  const requiredNames = new Set(requiredAssets);
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      entryOffset + 46 > archive.length ||
      archive.readUInt32LE(entryOffset) !== 0x02014b50
    ) {
      throw new Error("Function archive has a malformed ZIP directory.");
    }

    const nameLength = archive.readUInt16LE(entryOffset + 28);
    const extraLength = archive.readUInt16LE(entryOffset + 30);
    const commentLength = archive.readUInt16LE(entryOffset + 32);
    const compressionMethod = archive.readUInt16LE(entryOffset + 10);
    const compressedSize = archive.readUInt32LE(entryOffset + 20);
    const uncompressedSize = archive.readUInt32LE(entryOffset + 24);
    totalUncompressedBytes += uncompressedSize;
    const localHeaderOffset = archive.readUInt32LE(entryOffset + 42);
    const nameStart = entryOffset + 46;
    const nameEnd = nameStart + nameLength;

    if (
      nameEnd > archive.length ||
      localHeaderOffset + 30 > archive.length ||
      archive.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw new Error("Function archive has a truncated ZIP entry.");
    }

    const name = archive
      .toString("utf8", nameStart, nameEnd)
      .replaceAll("\\", "/");
    names.add(name);

    if (requiredNames.has(name)) {
      const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > archive.length) {
        throw new Error("Function archive has a truncated ZIP entry.");
      }

      const compressed = archive.subarray(dataStart, dataEnd);
      let data;
      if (compressionMethod === 0) {
        data = compressed;
      } else if (compressionMethod === 8) {
        data = zlib.inflateRawSync(compressed);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }
      if (data.length !== uncompressedSize) {
        throw new Error(`Function archive has a corrupt entry: ${name}`);
      }
      contents.set(name, data);
    }

    entryOffset = nameEnd + extraLength + commentLength;
  }

  return { names, contents, totalUncompressedBytes };
}

function verifyFunctionArchive(rootDirectory = process.cwd()) {
  const archivePath = path.join(rootDirectory, ".netlify", "functions", "api.zip");
  if (!fs.existsSync(archivePath)) {
    throw new Error(
      "Netlify function archive was not generated at .netlify/functions/api.zip.",
    );
  }
  const archiveSize = fs.statSync(archivePath).size;
  if (archiveSize > maximumFunctionArchiveBytes) {
    throw new Error(
      `Netlify api function archive is ${(
        archiveSize /
        (1024 * 1024)
      ).toFixed(2)} MiB; it must remain below ${(
        maximumFunctionArchiveBytes /
        (1024 * 1024)
      ).toFixed(0)} MiB.`,
    );
  }

  const functionEntry = "netlify/functions/api.js";
  const entries = zipEntries(archivePath, [functionEntry]);
  if (entries.totalUncompressedBytes > maximumFunctionUncompressedBytes) {
    throw new Error(
      `Netlify api function archive expands to ${(
        entries.totalUncompressedBytes /
        (1024 * 1024)
      ).toFixed(2)} MiB; it must remain below ${(
        maximumFunctionUncompressedBytes /
        (1024 * 1024)
      ).toFixed(0)} MiB.`,
    );
  }
  if (!entries.names.has(functionEntry)) {
    throw new Error(
      `Netlify function archive is missing the expected bundled entry: ${functionEntry}`,
    );
  }

  const missingRuntimeEntries = requiredRuntimeEntries.filter(
    (entry) => !entries.names.has(entry),
  );
  if (missingRuntimeEntries.length > 0) {
    throw new Error(
      `Netlify function archive is missing required Linux runtime files: ${missingRuntimeEntries.join(", ")}`,
    );
  }

  const sharpLibvipsDirectory =
    "node_modules/@img/sharp-libvips-linux-x64/lib/";
  if (
    ![...entries.names].some(
      (entry) =>
        entry.startsWith(sharpLibvipsDirectory) &&
        /libvips-cpp(?:-[^/]+)?\.so(?:\.\d+)*$/.test(entry),
    )
  ) {
    throw new Error(
      "Netlify function archive is missing the Linux x64 Sharp libvips binary.",
    );
  }

  const onnxBinaryEntries = [...entries.names].filter(
    (entry) =>
      entry.startsWith("node_modules/onnxruntime-node/bin/") &&
      !entry.endsWith("/"),
  );
  const unexpectedOnnxEntries = onnxBinaryEntries.filter(
    (entry) =>
      !entry.startsWith(
        "node_modules/onnxruntime-node/bin/napi-v6/linux/x64/",
      ),
  );
  if (unexpectedOnnxEntries.length > 0) {
    throw new Error(
      `Netlify function archive contains non-Linux-x64 ONNX binaries: ${unexpectedOnnxEntries.slice(0, 5).join(", ")}`,
    );
  }

  const unwantedNativeEntries = [...entries.names].filter(
    (entry) =>
      /node_modules\/onnxruntime-node\/bin\/.*libonnxruntime_providers_(?:cuda|tensorrt)\.so/i.test(
        entry,
      ) ||
      /node_modules\/@img\/sharp-(?:linuxmusl|libvips-linuxmusl)-/.test(
        entry,
      ),
  );
  if (unwantedNativeEntries.length > 0) {
    throw new Error(
      `Netlify function archive contains unused GPU or musl runtime files: ${unwantedNativeEntries.slice(0, 5).join(", ")}`,
    );
  }

  const manifestPath = path.join(
    rootDirectory,
    ".netlify",
    "functions",
    "manifest.json",
  );
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Netlify function manifest is missing.");
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Netlify function manifest is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const deployedFunctions = Array.isArray(manifest.functions)
    ? manifest.functions.map((entry) => entry.name)
    : [];
  if (
    deployedFunctions.length !== 1 ||
    deployedFunctions[0] !== "api"
  ) {
    throw new Error(
      `Expected only the api function to be deployed; found: ${
        deployedFunctions.join(", ") || "none"
      }.`,
    );
  }

  const bundle = entries.contents.get(functionEntry)?.toString("utf8");
  if (!bundle) {
    throw new Error(`Netlify function archive could not read ${functionEntry}.`);
  }

  for (const assetName of requiredAssetNames) {
    const assetPath = path.join(rootDirectory, "data", assetName);
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Required source knowledge asset is missing: data/${assetName}`);
    }

    let assetData;
    try {
      assetData = JSON.parse(fs.readFileSync(assetPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Source knowledge asset is invalid JSON: ${assetName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!assetData || typeof assetData !== "object" || Array.isArray(assetData)) {
      throw new Error(`Source knowledge asset must contain a JSON object: ${assetName}`);
    }

    const missingValues = [...collectStringValues(assetData)].filter(
      (value) => !bundle.includes(JSON.stringify(value)),
    );
    const missingProperties = [...collectPropertyNames(assetData)].filter(
      (propertyName) => !includesBundledProperty(bundle, propertyName),
    );
    if (missingValues.length > 0 || missingProperties.length > 0) {
      throw new Error(
        `Netlify function bundle is missing embedded knowledge data from data/${assetName}.`,
      );
    }
  }

  return requiredAssetNames.map((asset) => `data/${asset} (embedded)`);
}

if (require.main === module) {
  try {
    const assets = verifyFunctionArchive();
    console.log(
      `Verified Netlify api archive size/runtime and knowledge assets: ${assets.join(", ")}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { verifyFunctionArchive, zipEntries };
