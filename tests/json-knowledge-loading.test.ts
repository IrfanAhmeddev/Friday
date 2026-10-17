import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadJsonKnowledge,
  resetJsonKnowledgeCache,
} from "../src/knowledge/json-knowledge-engine";
import { enrichWithJsonKnowledge } from "../src/nlu/json-enrichment-engine";
import { understandIntent } from "../src/nlu/hybrid-intent-engine";

const knowledgeFiles = [
  "entities.json",
  "patterns.json",
  "synonyms.json",
  "vocabulary.json",
];

test("all required source knowledge assets exist and are loaded", () => {
  resetJsonKnowledgeCache();
  const knowledge = loadJsonKnowledge();

  for (const file of knowledgeFiles) {
    const sourcePath = path.join(process.cwd(), "data", file);
    assert.ok(existsSync(sourcePath), `Expected source asset data/${file}`);
    assert.doesNotThrow(() => JSON.parse(readFileSync(sourcePath, "utf8")));
  }

  assert.ok(Object.keys(knowledge.vocabulary).length > 0);
  assert.ok(Object.keys(knowledge.synonyms).length > 0);
  assert.ok(Object.keys(knowledge.patterns).length > 0);
  assert.ok(Object.keys(knowledge.entities).length > 0);
});

test("Netlify artifact verification fails when knowledge is not embedded", () => {
  const temporaryRoot = mkdtempSync(
    path.join(os.tmpdir(), "friday-missing-function-asset-"),
  );
  const archiveDirectory = path.join(temporaryRoot, ".netlify", "functions");
  const dataDirectory = path.join(temporaryRoot, "data");
  const sourceDataDirectory = path.join(process.cwd(), "data");
  mkdirSync(archiveDirectory, { recursive: true });
  mkdirSync(dataDirectory, { recursive: true });

  try {
    for (const file of knowledgeFiles) {
      copyFileSync(
        path.join(sourceDataDirectory, file),
        path.join(dataDirectory, file),
      );
    }
    writeFileSync(
      path.join(archiveDirectory, "api.zip"),
      createStoredZip({ "netlify/functions/api.js": "module.exports = {};" }),
    );

    const result = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts", "verify-netlify-function-assets.cjs")],
      { cwd: temporaryRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing embedded knowledge data/);
    assert.match(result.stderr, /data\/entities\.json/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function createStoredZip(files: Record<string, string>): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30 + fileName.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    fileName.copy(local, 30);
    data.copy(local, 30 + fileName.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + fileName.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(localOffset, 42);
    fileName.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }

  const localData = Buffer.concat(localRecords);
  const centralData = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centralRecords.length, 8);
  end.writeUInt16LE(centralRecords.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localData.length, 16);
  return Buffer.concat([localData, centralData, end]);
}

test("JSON knowledge loads and enriches intent understanding", async () => {
  resetJsonKnowledgeCache();

  const knowledge = loadJsonKnowledge();
  assert.ok(Object.keys(knowledge.vocabulary).length > 0);
  assert.ok(Object.keys(knowledge.synonyms).length > 0);
  assert.ok(Object.keys(knowledge.patterns).length > 0);
  assert.ok(Object.keys(knowledge.entities).length > 0);

  const enrichment = enrichWithJsonKnowledge("create a new document");
  assert.ok(enrichment.canonicalTerms.includes("create"));
  assert.ok(enrichment.canonicalTerms.includes("document"));
  assert.ok(enrichment.relatedActions.includes("workspace.create"));
  assert.equal(enrichment.patternMatch.intent, "workspace.create");

  const intent = await understandIntent(
    "create a new document",
    async () => [1, 0],
  );
  assert.equal(intent.jsonPatternIntent, "workspace.create");
  assert.ok(intent.jsonCanonicalTerms.includes("create"));
  assert.ok(intent.jsonRelatedActions.includes("workspace.create"));
});
