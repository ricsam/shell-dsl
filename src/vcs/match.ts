/**
 * Match a file path against a glob pattern.
 * Supports `**` for recursive directory matching, `*` for single segment wildcard.
 */
export function matchGlobPath(pattern: string, filePath: string): boolean {
  // Normalize: strip leading slashes
  const p = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const f = filePath.startsWith("/") ? filePath.slice(1) : filePath;

  const patternParts = p.split("/");
  const pathParts = f.split("/");

  return matchParts(patternParts, pathParts, 0, 0);
}

function matchParts(
  pattern: string[],
  path: string[],
  pi: number,
  fi: number,
): boolean {
  while (pi < pattern.length && fi < path.length) {
    const seg = pattern[pi]!;

    if (seg === "**") {
      // ** matches zero or more path segments
      // Try matching rest of pattern against current position and all subsequent positions
      for (let i = fi; i <= path.length; i++) {
        if (matchParts(pattern, path, pi + 1, i)) return true;
      }
      return false;
    }

    if (!matchSegment(seg, path[fi]!)) return false;
    pi++;
    fi++;
  }

  // Skip trailing ** patterns
  while (pi < pattern.length && pattern[pi] === "**") pi++;

  return pi === pattern.length && fi === path.length;
}

function matchSegment(pattern: string, segment: string): boolean {
  // Convert glob segment to regex
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    switch (c) {
      case "*":
        regex += "[^/]*";
        break;
      case "?":
        regex += "[^/]";
        break;
      case ".":
      case "^":
      case "$":
      case "+":
      case "{":
      case "}":
      case "(":
      case ")":
      case "|":
      case "\\":
        regex += "\\" + c;
        break;
      default:
        regex += c;
    }
  }
  regex += "$";

  try {
    return new RegExp(regex).test(segment);
  } catch {
    return false;
  }
}
