import { findSemanticMatches } from "../src/ml/semantic.matcher";

async function main() {
  const inputs = [
    "create a document",
    "make a document",
    "make me a report",
    "I need a new report",
    "start a new document",
    "open my report",
    "show my documents",
    "delete the report",
    "rename my document",
  ];

  const candidates = [
    "create a document",
    "open a document",
    "show documents",
    "delete a document",
    "create a spreadsheet",
    "rename a document",
  ];

  for (const input of inputs) {
    console.log("\n================================");
    console.log(`Input: "${input}"`);
    console.log("================================");

    const matches = await findSemanticMatches(
      input,
      candidates
    );

    for (const match of matches) {
      console.log(
        `${match.similarity.toFixed(4)}  ${match.text}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});