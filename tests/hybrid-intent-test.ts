import { classifyIntent } from "../src/nlu/hybrid-intent-engine";

const testInputs = [
  "make me a report",
  "I need a new document",
  "prepare a fresh report",
  "open my latest file",
  "can you bring up that document",
  "show all my notes",
  "let me see my files",
  "change the name of my report",
  "retitle this document",
  "remove that file",
  "modify the contents of my document",
  "this sentence does not represent a workspace action",
  "could you create something for my project",
  "I want a fresh report for college",
  "bring up the document I worked on yesterday",
  "I want to see everything inside my workspace",
  "give this file a different title",
  "get rid of the old report",
  "I want to update the text inside this document",
  "what is the weather today",
  "tell me a joke",
  "how are you doing",
];

async function main(): Promise<void> {
  for (const input of testInputs) {
    const result = await classifyIntent(input);

    console.log("\nInput:", input);
    console.log("Intent:", result.intent);
    console.log("Confidence:", result.confidence);
    console.log(
      "Matched example:",
      result.matchedTrainingText,
    );

    console.log("Lexical score:", result.lexicalScore);
    console.log("Semantic score:", result.semanticScore);
    console.log("Keyword score:", result.keywordScore);

    console.log(
      "Workspace object:",
      result.workspaceObject,
    );

    console.log(
      "Object matched text:",
      result.workspaceObjectMatchedText,
    );

    console.log(
      "Object confidence:",
      result.workspaceObjectConfidence,
    );
  }
}

main().catch((error) => {
  console.error(
    "Hybrid intent test failed:",
    error,
  );

  process.exit(1);
});