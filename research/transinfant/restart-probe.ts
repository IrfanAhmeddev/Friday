import { readFile } from "node:fs/promises";
import { KnowledgeStore } from "../../src/transinfant/memory-store";
import { understand } from "../../src/nlu/friday";

interface ProbeDataset {
  test: Array<{
    id: string;
    text: string;
    expected: { action: string; object: string };
  }>;
}

async function main(): Promise<void> {
  const [storePath, datasetPath] = process.argv.slice(2);
  if (!storePath || !datasetPath) {
    throw new Error("Usage: restart-probe.ts <store-path> <dataset-path>");
  }

  const dataset = JSON.parse(
    await readFile(datasetPath, "utf8"),
  ) as ProbeDataset;
  const store = new KnowledgeStore(storePath);
  const rows = [];

  for (const example of dataset.test) {
    const result = await understand(
      example.text,
      `e002-process-restart-${example.id}`,
      {
        transinfantEnabled: true,
        transinfantStore: store,
        transinfantMode: "composition",
      },
    );
    const predicted = {
      action: result.semantic.action,
      object: result.semantic.object,
    };
    rows.push({
      id: example.id,
      expected: example.expected,
      predicted,
      exact:
        predicted.action === example.expected.action &&
        predicted.object === example.expected.object,
    });
  }

  process.stdout.write(`${JSON.stringify({ rows })}\n`);
}

console.log = () => undefined;
main().catch((error: unknown) => {
  console.error("Process-restart probe failed:", error);
  process.exitCode = 1;
});
