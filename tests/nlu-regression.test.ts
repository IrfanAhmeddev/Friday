import test from "node:test";
import assert from "node:assert/strict";

import { detectActionConcept } from "../src/nlu/action-concept-engine";
import {
  createDialogueMemory,
  processDialogueTurn,
} from "../src/nlu/dialogue-manager";
import { understand } from "../src/nlu/friday";
import { understandIntent } from "../src/nlu/hybrid-intent-engine";
import { planResponse } from "../src/nlu/response-planner";
import { createIntelligenceContract } from "../src/types/intelligence-contract";
import { extractWorkspaceObject } from "../src/nlu/entity-extraction-engine";

test("stronger verb remains authoritative over the weak new-signal create heuristic", () => {
  const showResult = detectActionConcept("show my new document");
  const openResult = detectActionConcept("open my new spreadsheet");
  const createResult = detectActionConcept("create a new document");

  assert.equal(showResult.action, "show");
  assert.equal(openResult.action, "open");
  assert.equal(createResult.action, "create");
});

test("a single transposition in an action verb is recovered and applications are recognized", () => {
  const typo = detectActionConcept("Opne the file");

  assert.equal(typo.action, "open");
  assert.equal(typo.fuzzy, true);
  assert.equal(extractWorkspaceObject("Close the application").workspaceObject, "application");
});

test("dialogue state preserves language and constraints across corrections", () => {
  let state = createDialogueMemory("session-1");

  const firstTurn = processDialogueTurn(state, "I want to create a frontend framework.", {
    intent: "workspace.create",
    semantic: { action: "create", object: "project" },
  });

  assert.equal(firstTurn.dialogueAct, "clarify");
  assert.deepEqual(firstTurn.state.pendingQuestions, ["Which language would you like to use?"]);

  const languageTurn = processDialogueTurn(firstTurn.state, "TypeScript.", {
    intent: "workspace.create",
  });

  assert.equal(languageTurn.state.parameters.language, "typescript");
  assert.equal(languageTurn.dialogueAct, "continue");

  const constraintTurn = processDialogueTurn(languageTurn.state, "Make it lightweight.", {
    intent: "workspace.create",
  });

  assert.ok(constraintTurn.state.constraints.includes("lightweight"));

  const correctionTurn = processDialogueTurn(
    constraintTurn.state,
    "Actually, use JavaScript instead.",
    {
      intent: "workspace.create",
    },
  );

  assert.equal(correctionTurn.state.parameters.language, "javascript");
  assert.ok(correctionTurn.state.constraints.includes("lightweight"));
  assert.equal(correctionTurn.dialogueAct, "correction");
});

test("response planner asks for clarification when a question is pending", () => {
  let state = createDialogueMemory("session-2");
  state.pendingQuestions = ["Which language would you like to use?"];

  const plan = planResponse("continue", state);

  assert.equal(plan.strategy, "clarify");
  assert.equal(plan.message, "Which language would you like to use?");
  assert.equal(plan.requiresClarification, true);
});

test("negated commands abstain instead of producing an executable action", async () => {
  const provider = async (): Promise<number[]> => {
    throw new Error("Embedding provider must not run for a negated command.");
  };
  const action = detectActionConcept("Please don't delete the report.");
  const hybrid = await understandIntent(
    "Please don't delete the report.",
    provider,
  );
  const result = await understand(
    "Please don't delete the report.",
    "negated-command",
    { transinfantEnabled: false, embeddingProvider: provider },
  );

  assert.equal(action.negated, true);
  assert.equal(action.action, "unknown");
  assert.equal(hybrid.negated, true);
  assert.equal(hybrid.intent, "unknown");
  assert.equal(result.semantic.action, "unknown");
  assert.equal(result.status, "unknown");
});

test("multiple distinct actions are surfaced as ambiguity and request clarification", async () => {
  const provider = async (): Promise<number[]> => {
    throw new Error("Embedding provider must not run for ambiguous actions.");
  };
  const result = await understand(
    "Create and delete the report.",
    "ambiguous-actions",
    { transinfantEnabled: false, embeddingProvider: provider },
  );
  const contract = createIntelligenceContract(
    "Create and delete the report.",
    result,
  );

  assert.equal(result.semantic.action, "unknown");
  assert.equal(contract.ambiguity.detected, true);
  assert.deepEqual(contract.ambiguity.candidateActions, ["create", "delete"]);
  assert.equal(contract.clarification.required, true);
  assert.match(contract.clarification.question ?? "", /multiple actions/);
});

test("ordinary negation is not mistaken for a user correction", () => {
  const turn = processDialogueTurn(createDialogueMemory("negative-turn"), "Do not delete it.", {
    intent: "unknown",
    semantic: { action: "unknown", object: "file" },
  });

  assert.notEqual(turn.dialogueAct, "correction");
});

test("FRIDAY resolves references within a session and keeps separate sessions isolated", async () => {
  const embeddingProvider = async (): Promise<number[]> => [1, 0];
  const first = await understand("Open my report", "reference-session", {
    transinfantEnabled: false,
    embeddingProvider,
  });
  const followUp = await understand("Show it", "reference-session", {
    transinfantEnabled: false,
    embeddingProvider,
  });
  const isolated = await understand("Show it", "isolated-session", {
    transinfantEnabled: false,
    embeddingProvider,
  });

  assert.equal(first.semantic.object, "report");
  assert.equal(followUp.semantic.action, "show");
  assert.equal(followUp.semantic.object, "report");
  assert.equal(followUp.reference.referencedObject, "report");
  assert.equal(isolated.reference.referencedObject, "unknown");
});

test("FRIDAY applies a conversational correction without dropping prior constraints", async () => {
  const embeddingProvider = async (): Promise<number[]> => [1, 0];
  const sessionId = "correction-session";
  const first = await understand("Create a framework", sessionId, {
    transinfantEnabled: false,
    embeddingProvider,
  });
  const correction = await understand("Actually, use JavaScript instead", sessionId, {
    transinfantEnabled: false,
    embeddingProvider,
  });
  const dialogue = correction.context.dialogue as {
    act: string;
    state: { parameters: Record<string, string> };
  };

  assert.equal(first.status, "understood");
  assert.equal(dialogue.act, "correction");
  assert.equal(dialogue.state.parameters.language, "javascript");
});
