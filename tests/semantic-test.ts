import { detectSemanticAction } from "../src/nlu/semantic-engine";

const tests = [
  "create a spreadsheet",
  "make me a new document",
  "start a new note",
  "open my document",
  "launch the application",
  "find my budget",
  "search for my notes",
  "show my latest document",
  "delete that file",
  "remove this folder",
  "rename my document",
  "close this",
  "hello Friday",
    "show my new document",
  "open my new spreadsheet",
  "create a new document",
  "make a new note",
  "build a new spreadsheet"
];

for (const text of tests) {
  const result = detectSemanticAction(text);

  console.log("\nInput:", text);
  console.log("Result:", result);
}