import type { TerminalInfo } from "../../src/index.ts";

export type CliRequest =
  | { type: "run"; id: number; source: string; terminal: TerminalInfo }
  | { type: "complete"; id: number; source: string; cursor: number }
  | { type: "resize"; terminal: TerminalInfo }
  | { type: "exit" };

export type ExecutorEvent =
  | { type: "ready"; cwd: string }
  | { type: "output"; id: number; fd: 1 | 2; data: string }
  | { type: "exit"; id: number; exitCode: number; cwd: string }
  | { type: "complete"; id: number; replacement: string; matches: string[] }
  | { type: "error"; id?: number; message: string };
