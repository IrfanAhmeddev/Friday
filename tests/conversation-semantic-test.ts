import {
  detectConversationalSemantic
} from "../src/nlu/conversation-semantic-engine";

const previousSemantic = {
  action: "create" as const,
  object: "spreadsheet" as const,
  confidence: 0.9,
  matchedWords: ["create"]
};

const previousEntities = [
  {
    type: "workspace_object",
    value: "spreadsheet",
    confidence: 0.98
  },
  {
    type: "name",
    value: "project budget",
    confidence: 0.95
  }
];

const tests = [
  "Call it Monthly Expenses",
  "Rename it to Monthly Expenses",
  "Change its name to Monthly Expenses",
  "Open it",
  "Delete that",
  "Create another spreadsheet"
];

for (const text of tests) {
  console.log("\nInput:", text);

  console.log(
    "Result:",
    detectConversationalSemantic(
      text,
      previousSemantic,
      previousEntities
    )
  );
}