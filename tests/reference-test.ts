import {
  resolveReference
} from "../src/nlu/reference-engine";

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
  "Open that one",
  "Delete it",
  "Show this",
  "Rename the previous one",
  "Create another spreadsheet"
];

for (const text of tests) {
  console.log("\nInput:", text);

  console.log(
    "Reference:",
    resolveReference(
      text,
      previousSemantic,
      previousEntities
    )
  );
}