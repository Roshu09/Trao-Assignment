import { readFile, writeFile } from "node:fs/promises";
import { parseEvaluateArgs } from "./args";

interface Case {
  id: string;
  jd: string;
  company_url: string;
  days: number;
}

/**
 * Batch entry point: `npm run evaluate -- --input <cases.json> --output <kits.json>`.
 * Placeholder for now: it reads the cases and records every one as failed, so the
 * output shape (Appendix B) is already correct. Day 1 replaces this with generateKit().
 */
async function main(): Promise<void> {
  const { input, output } = parseEvaluateArgs(process.argv.slice(2));
  const cases = JSON.parse(await readFile(input, "utf8")) as Case[];

  const kits = cases.map((c) => ({
    id: c.id,
    status: "failed" as const,
    kit: null,
    error: { code: "NOT_IMPLEMENTED", message: "Pipeline not built yet." },
  }));

  await writeFile(
    output,
    JSON.stringify({ version: "1.0", generated_at: new Date().toISOString(), kits }, null, 2),
  );
  console.log(`Wrote ${kits.length} entries to ${output}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
