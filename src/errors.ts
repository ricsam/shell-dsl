export class ShellError extends Error {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;

  constructor(message: string, stdout: Buffer, stderr: Buffer, exitCode: number) {
    super(message);
    this.name = "ShellError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class LexError extends Error {
  position: number;
  line: number;
  column: number;

  constructor(message: string, position: number, line: number, column: number) {
    super(`Lex error at line ${line}, column ${column}: ${message}`);
    this.name = "LexError";
    this.position = position;
    this.line = line;
    this.column = column;
  }
}

export class ParseError extends Error {
  position?: number;

  constructor(message: string, position?: number) {
    super(message);
    this.name = "ParseError";
    this.position = position;
  }
}
