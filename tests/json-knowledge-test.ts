import {
  extractEntityFromKnowledge,
  findCanonicalTerms,
  loadJsonKnowledge,
  lookupVocabulary,
  matchPattern
} from "../src/knowledge/json-knowledge-engine";

console.log("Loading JSON knowledge...\n");

const knowledge = loadJsonKnowledge();

console.log("Vocabulary terms:", Object.keys(knowledge.vocabulary).length);
console.log("Synonyms:", Object.keys(knowledge.synonyms).length);
console.log("Pattern groups:", Object.keys(knowledge.patterns).length);
console.log("Entity groups:", Object.keys(knowledge.entities).length);

console.log("\n--- Vocabulary Lookup Tests ---");

const vocabularyTests = [
  "create",
  "launch",
  "bring up",
  "notes",
  "unknownword"
];

for (const input of vocabularyTests) {
  console.log(input, "=>", lookupVocabulary(input));
}

console.log("\n--- Canonical Term Detection ---");

const canonicalTests = [
  "please bring up my latest notes",
  "make a new spreadsheet",
  "launch the document",
  "throw away that old file"
];

for (const input of canonicalTests) {
  console.log(input, "=>", findCanonicalTerms(input));
}

console.log("\n--- Pattern Matching Tests ---");

const patternTests = [
  "create a new document",
  "please bring up my report",
  "let me see all my files",
  "modify the contents of this document",
  "give this file a different title",
  "throw away this file",
  "tell me a joke"
];

for (const input of patternTests) {
  console.log(input, "=>", matchPattern(input));
}

console.log("\n--- Entity Extraction Tests ---");

const entityTests = [
  "create a document",
  "open my latest spreadsheet",
  "show all my notes",
  "delete that file",
  "prepare a presentation",
  "work on my project",
  "what is the weather today"
];

for (const input of entityTests) {
  console.log(input, "=>", extractEntityFromKnowledge(input));
}