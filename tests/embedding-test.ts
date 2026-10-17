import { pipeline } from "@huggingface/transformers";

async function main() {
  console.log("Loading embedding model...");

  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  console.log("Model loaded.");

  const result = await extractor(
    "create a new document",
    {
      pooling: "mean",
      normalize: true,
    }
  );

  console.log("Embedding generated.");
  console.log("Dimensions:", result.dims);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});