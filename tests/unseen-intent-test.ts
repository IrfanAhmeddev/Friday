import { understandIntent } from "../src/nlu/hybrid-intent-engine";

const testInputs = [
  "I want to start a fresh document",
  "please launch my latest spreadsheet",
  "can you list everything in my workspace",
  "I need to change the title of this report",
  "please erase the old presentation",
  "add a paragraph to my notes",
  "open the file from yesterday",
  "make a new slide deck",
  "show me all my spreadsheets",
  "I want to rename this project",
  "tell me a funny story",
  "what is the temperature outside",
  "explain how photosynthesis works",
  "play some music",
  "who are you",
];

async function runTests(): Promise<void> {
  for (const input of testInputs) {
    const result = await understandIntent(input);

    console.log("\nInput:", input);
    console.log("Intent:", result.intent);
    console.log("Confidence:", result.confidence);
    console.log("Action concept:", result.actionConcept);
    console.log("Matched example:", result.matchedTrainingText);
    console.log("Workspace object:", result.workspaceObject);
    console.log(
      "JSON pattern intent:",
      result.jsonPatternIntent,
    );
    console.log(
      "JSON canonical terms:",
      result.jsonCanonicalTerms,
    );
    console.log(
      "JSON related actions:",
      result.jsonRelatedActions,
    );
  }
}

runTests().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});