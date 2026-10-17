import { detectActionConcept } from "../src/nlu/action-concept-engine";

const inputs = [
  "create a document",
  "make me a report",
  "bring up my latest file",
  "take me to my document",
  "show everything in my workspace",
  "let me see my notes",
  "give this file a different title",
  "change the name of my report",
  "get rid of the old document",
  "modify the contents of this file",
  "what is the weather today",
];

for (const input of inputs) {
  const result = detectActionConcept(input);

  console.log("\nInput:", input);
  console.log("Action:", result.action);
  console.log("Confidence:", result.confidence);
  console.log("Matched words:", result.matchedWords);
  console.log("Matched phrase:", result.matchedPhrase);
}