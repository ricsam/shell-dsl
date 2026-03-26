import { strict as assert } from "node:assert";
import { stat } from "node:fs/promises";
import { FileSystem, VersionControlSystem } from "../src/index.ts";

interface CliOptions {
  repoPath: string;
  repeat: number;
}

const usage = `Usage:
  bun scripts/vcs-status-profile.ts --repo-path <path> [--repeat <count>]

Example:
  bun scripts/vcs-status-profile.ts --repo-path /tmp/shell-dsl-vcs-bench/repo --repeat 1
`;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoStat = await stat(options.repoPath);
  assert(repoStat.isDirectory(), `repo-path is not a directory: ${options.repoPath}`);

  const fs = new FileSystem(options.repoPath);
  const vcs = new VersionControlSystem({ fs, path: "/" });
  const runs: Array<{ iteration: number; wallMs: number; changeCount: number }> = [];

  for (let iteration = 1; iteration <= options.repeat; iteration++) {
    const startedAt = performance.now();
    const changes = await vcs.status();
    const wallMs = performance.now() - startedAt;
    runs.push({
      iteration,
      wallMs: round2(wallMs),
      changeCount: changes.length,
    });
  }

  console.log(JSON.stringify({
    repoPath: options.repoPath,
    repeat: options.repeat,
    runs,
  }, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  let repoPath: string | undefined;
  let repeat = 1;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }

    const [flag, inlineValue] = arg.split("=", 2);
    const value =
      inlineValue ??
      (args[index + 1]?.startsWith("--") ? undefined : args[index + 1]);

    switch (flag) {
      case "--repo-path":
        repoPath = requireValue(flag, value);
        if (!inlineValue) index++;
        break;
      case "--repeat":
        repeat = Number.parseInt(requireValue(flag, value), 10);
        if (!inlineValue) index++;
        break;
      default:
        throw new Error(`unknown argument: ${arg}\n\n${usage}`);
    }
  }

  if (!repoPath) {
    throw new Error(`missing required --repo-path argument\n\n${usage}`);
  }

  if (!Number.isInteger(repeat) || repeat <= 0) {
    throw new Error(`--repeat must be a positive integer\n\n${usage}`);
  }

  return { repoPath, repeat };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`missing value for ${flag}\n\n${usage}`);
  }
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
