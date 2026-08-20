import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(workerDirectory, "..");
const documentsPath = join(repositoryDirectory, "backend", "portfolio_docs.json");
const backendEnvironmentPath = join(repositoryDirectory, "backend", ".env");
const indexName = "nicobot-portfolio";
const embeddingModel = "text-embedding-3-large";
const dimensions = 1536;

function readEnvironmentValue(contents, name) {
  const line = contents
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) return "";
  return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, "");
}

async function main() {
  const localEnvironment = existsSync(backendEnvironmentPath)
    ? readFileSync(backendEnvironmentPath, "utf8")
    : "";
  const apiKey =
    process.env.OPENAI_API_KEY ||
    readEnvironmentValue(localEnvironment, "OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const documents = JSON.parse(readFileSync(documentsPath, "utf8"));
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new Error("portfolio_docs.json does not contain documents");
  }

  const embeddingResponse = await fetch(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: documents.map((document) => document.content),
        dimensions,
        encoding_format: "float",
      }),
    },
  );
  if (!embeddingResponse.ok) {
    const body = await embeddingResponse.text();
    throw new Error(
      `Embedding request failed (${embeddingResponse.status}): ${body.slice(0, 300)}`,
    );
  }

  const embeddingBody = await embeddingResponse.json();
  const embeddings = embeddingBody.data;
  if (!Array.isArray(embeddings) || embeddings.length !== documents.length) {
    throw new Error("OpenAI returned an unexpected number of embeddings");
  }

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "nicobot-vectorize-"),
  );
  const vectorsPath = join(temporaryDirectory, "vectors.ndjson");

  try {
    const lines = documents.map((document, index) => {
      const values = embeddings[index]?.embedding;
      if (!Array.isArray(values) || values.length !== dimensions) {
        throw new Error(`Invalid embedding for ${document.id}`);
      }
      return JSON.stringify({
        id: document.id,
        values,
        metadata: { content: document.content },
      });
    });
    writeFileSync(vectorsPath, `${lines.join("\n")}\n`, { mode: 0o600 });
    execFileSync(
      "npx",
      [
        "wrangler",
        "vectorize",
        "upsert",
        indexName,
        "--file",
        vectorsPath,
      ],
      { cwd: workerDirectory, stdio: "inherit" },
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  console.log(
    `Indexed ${documents.length} portfolio documents in ${indexName} (${dimensions} dimensions).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
