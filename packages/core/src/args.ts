export interface EvaluateArgs {
  input: string;
  output: string;
}

/**
 * Parses `--input <file> --output <file>` from process arguments.
 * Throws a readable error so the CLI can print it and exit non-zero.
 */
export function parseEvaluateArgs(argv: string[]): EvaluateArgs {
  const values: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values[key] = value;
    i++;
  }

  if (!values.input) throw new Error("Missing required argument --input <cases.json>");
  if (!values.output) throw new Error("Missing required argument --output <kits.json>");

  return { input: values.input, output: values.output };
}
