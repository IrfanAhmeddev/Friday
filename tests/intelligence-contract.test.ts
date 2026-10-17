import assert from "node:assert/strict";
import test from "node:test";
import {
  createIntelligenceContract,
  validateIntelligenceContract,
} from "../src/types/intelligence-contract";
import type { NLUResult } from "../src/types/nlu";

const result: NLUResult = {
  status: "uncertain",
  intent: { name: "workspace.open", confidence: 0.62 },
  semantic: {
    action: "open",
    object: "file",
    confidence: 0.62,
    matchedWords: ["open", "file"],
  },
  reference: {
    hasReference: true,
    reference: "previous",
    referencedObject: "file",
    referencedName: "notes.txt",
    matchedWords: ["it"],
    confidence: 0.8,
  },
  entities: [{ type: "workspace_object", value: "file", confidence: 0.9 }],
  context: {
    normalizedText: "open it",
    sessionId: "session-1",
    conversation: {
      historyLength: 1,
      previousInput: "create notes.txt",
    },
    dialogue: {
      act: "clarify",
      clarification: "Which file should I open?",
      state: { constraints: ["read-only"] },
    },
    transinfant: {
      status: "applied",
      candidate: {
        action: "open",
        object: "file",
        confidence: 0.7,
        evidence: ["accepted relation"],
      },
    },
  },
};

test("v1 contract carries legacy interpretation, context and explicit non-planning state", () => {
  const contract = createIntelligenceContract("Open it", result);

  assert.equal(contract.contractVersion, "1.0");
  assert.equal(contract.originalInput, "Open it");
  assert.equal(contract.normalizedUtterance, "open it");
  assert.equal(contract.conversation.sessionId, "session-1");
  assert.equal(contract.conversation.previousInput, "create notes.txt");
  assert.equal(contract.conversation.previousSemantic, null);
  assert.equal(contract.dialogue.act, "clarify");
  assert.equal(contract.dialogue.activeTopic, null);
  assert.deepEqual(contract.constraints, ["read-only"]);
  assert.equal(contract.clarification.required, true);
  assert.equal(contract.clarification.question, "Which file should I open?");
  assert.equal(contract.conceptualEvidence.status, "applied");
  assert.equal(contract.confidence.basis, "heuristic");
  assert.equal(contract.planning.status, "not_proposed");
  assert.deepEqual(contract.planning.steps, []);
  assert.deepEqual(validateIntelligenceContract(contract), contract);
});

test("v1 contract rejects invalid confidence and malformed entity data", () => {
  const contract = createIntelligenceContract("Open it", result);

  assert.throws(
    () => validateIntelligenceContract({
      ...contract,
      confidence: { ...contract.confidence, score: 1.2 },
    }),
    /confidence.score/,
  );
  assert.throws(
    () => validateIntelligenceContract({
      ...contract,
      entities: [{ type: "file", value: "notes.txt", confidence: Number.NaN }],
    }),
    /entities\[0\].confidence/,
  );
});
