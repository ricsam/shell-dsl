interface DiffOp {
  type: "equal" | "insert" | "delete";
  line: string;
}

interface HunkRange {
  start: number;
  end: number;
}

const CONTEXT_LINES = 3;

export function createUnifiedPatch(path: string, previousText: string, nextText: string): string | undefined {
  if (previousText === nextText) {
    return undefined;
  }

  const previousLines = splitLines(previousText);
  const nextLines = splitLines(nextText);
  const operations = diffLines(previousLines, nextLines);
  const hunks = collectHunks(operations);

  if (hunks.length === 0) {
    return undefined;
  }

  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const hunk of hunks) {
    lines.push(formatHunkHeader(operations, hunk));
    for (let i = hunk.start; i < hunk.end; i++) {
      const operation = operations[i]!;
      const prefix =
        operation.type === "equal" ? " " : operation.type === "delete" ? "-" : "+";
      lines.push(prefix + operation.line);
    }
  }

  return lines.join("\n");
}

function splitLines(text: string): string[] {
  if (!text) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    parts.pop();
  }
  return parts;
}

function diffLines(previousLines: string[], nextLines: string[]): DiffOp[] {
  const previousCount = previousLines.length;
  const nextCount = nextLines.length;
  const max = previousCount + nextCount;
  const trace: Map<number, number>[] = [];
  let frontier = new Map<number, number>();
  frontier.set(1, 0);

  for (let depth = 0; depth <= max; depth++) {
    trace.push(new Map(frontier));

    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const nextX = frontier.get(diagonal + 1) ?? 0;
      const prevX = frontier.get(diagonal - 1) ?? 0;
      let x: number;

      if (diagonal === -depth || (diagonal !== depth && prevX < nextX)) {
        x = nextX;
      } else {
        x = prevX + 1;
      }

      let y = x - diagonal;
      while (
        x < previousCount &&
        y < nextCount &&
        previousLines[x] === nextLines[y]
      ) {
        x++;
        y++;
      }

      frontier.set(diagonal, x);

      if (x >= previousCount && y >= nextCount) {
        return backtrack(trace, previousLines, nextLines);
      }
    }
  }

  return [];
}

function backtrack(
  trace: Map<number, number>[],
  previousLines: string[],
  nextLines: string[],
): DiffOp[] {
  const operations: DiffOp[] = [];
  let x = previousLines.length;
  let y = nextLines.length;

  for (let depth = trace.length - 1; depth >= 0; depth--) {
    const frontier = trace[depth]!;
    const diagonal = x - y;

    let previousDiagonal: number;
    if (
      diagonal === -depth ||
      (diagonal !== depth && (frontier.get(diagonal - 1) ?? 0) < (frontier.get(diagonal + 1) ?? 0))
    ) {
      previousDiagonal = diagonal + 1;
    } else {
      previousDiagonal = diagonal - 1;
    }

    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      operations.push({ type: "equal", line: previousLines[x - 1]! });
      x--;
      y--;
    }

    if (depth === 0) {
      break;
    }

    if (x === previousX) {
      operations.push({ type: "insert", line: nextLines[y - 1]! });
      y--;
    } else {
      operations.push({ type: "delete", line: previousLines[x - 1]! });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    operations.push({ type: "equal", line: previousLines[x - 1]! });
    x--;
    y--;
  }
  while (x > 0) {
    operations.push({ type: "delete", line: previousLines[x - 1]! });
    x--;
  }
  while (y > 0) {
    operations.push({ type: "insert", line: nextLines[y - 1]! });
    y--;
  }

  return operations.reverse();
}

function collectHunks(operations: DiffOp[]): HunkRange[] {
  const changeRanges: HunkRange[] = [];
  let rangeStart: number | null = null;

  for (let index = 0; index < operations.length; index++) {
    if (operations[index]!.type === "equal") {
      continue;
    }
    if (rangeStart === null) {
      rangeStart = Math.max(0, index - CONTEXT_LINES);
    }
    let rangeEnd = Math.min(operations.length, index + CONTEXT_LINES + 1);

    while (
      rangeEnd < operations.length &&
      operations.slice(index + 1, rangeEnd).some((op) => op.type !== "equal")
    ) {
      rangeEnd = Math.min(operations.length, rangeEnd + CONTEXT_LINES);
    }

    const previousRange = changeRanges[changeRanges.length - 1];
    if (previousRange && rangeStart <= previousRange.end) {
      previousRange.end = Math.max(previousRange.end, rangeEnd);
    } else {
      changeRanges.push({ start: rangeStart, end: rangeEnd });
    }
    rangeStart = null;
  }

  return changeRanges;
}

function formatHunkHeader(operations: DiffOp[], hunk: HunkRange): string {
  let oldStart = 1;
  let newStart = 1;

  for (let index = 0; index < hunk.start; index++) {
    const operation = operations[index]!;
    if (operation.type !== "insert") {
      oldStart++;
    }
    if (operation.type !== "delete") {
      newStart++;
    }
  }

  let oldCount = 0;
  let newCount = 0;
  for (let index = hunk.start; index < hunk.end; index++) {
    const operation = operations[index]!;
    if (operation.type !== "insert") {
      oldCount++;
    }
    if (operation.type !== "delete") {
      newCount++;
    }
  }

  return `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`;
}

function formatRange(start: number, count: number): string {
  if (count === 0) {
    return `${start - 1},0`;
  }
  if (count === 1) {
    return String(start);
  }
  return `${start},${count}`;
}
