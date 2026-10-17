import { enrichWithJsonKnowledge } from "../src/nlu/json-enrichment-engine";

const testInputs = [
  "please bring up my latest notes",
  "make a new spreadsheet",
  "throw away that old file",
  "give this document a different title",
  "modify the contents of my report",
  "tell me a joke"
];

for (const input of testInputs) {
  const result = enrichWithJsonKnowledge(input);

  console.log("\n====================================");
  console.log("Input:", result.input);
  console.log("Canonical terms:", result.canonicalTerms);
  console.log("Pattern match:", result.patternMatch);
  console.log("Entity:", result.entity);
  console.log("Related actions:", result.relatedActions);
  console.log("Has action knowledge:", result.hasActionKnowledge);
  console.log("Has entity knowledge:", result.hasEntityKnowledge);
}