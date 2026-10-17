import {
  extractWorkspaceObject,
} from "../src/nlu/entity-extraction-engine";

const testInputs = [
  "create a document",
  "open my spreadsheet",
  "show all my notes",
  "delete that file",
  "edit the report",
  "create a presentation",
  "open my project",
  "what is the weather today",
];

for (const input of testInputs) {
  const result = extractWorkspaceObject(input);

  console.log(`\nInput: ${input}`);
  console.log(`Object: ${result.workspaceObject}`);
  console.log(`Matched text: ${result.matchedText}`);
  console.log(`Confidence: ${result.confidence}`);
}