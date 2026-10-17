import test from "node:test";
import assert from "node:assert/strict";

import { detectActionConcept } from "../src/nlu/action-concept-engine";
import {
  createDialogueMemory,
  processDialogueTurn,
} from "../src/nlu/dialogue-manager";
import { planResponse } from "../src/nlu/response-planner";

test("stronger verb remains authoritative over the weak new-signal create heuristic", () => {
  const showResult = detectActionConcept("show my new document");
  const openResult = detectActionConcept("open my new spreadsheet");
  const createResult = detectActionConcept("create a new document");

  assert.equal(showResult.action, "show");
  assert.equal(openResult.action, "open");
  assert.equal(createResult.action, "create");
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
