/**
 * Simple glob pattern matching (fnmatch-style)
 * Supports: * (any chars), ? (single char), [...] (character class)
 */
export function matchGlob(pattern: string, str: string, caseInsensitive = false): boolean {
  if (caseInsensitive) {
    pattern = pattern.toLowerCase();
    str = str.toLowerCase();
  }

  // Convert glob to regex
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    switch (c) {
      case "*":
        regex += ".*";
        break;
      case "?":
        regex += ".";
        break;
      case "[": {
        // Find closing bracket
        let j = i + 1;
        // Handle negation
        if (pattern[j] === "!" || pattern[j] === "^") j++;
        // Handle ] as first char in class
        if (pattern[j] === "]") j++;
        while (j < pattern.length && pattern[j] !== "]") j++;
        if (j >= pattern.length) {
          // No closing bracket, treat [ as literal
          regex += "\\[";
        } else {
          let charClass = pattern.slice(i, j + 1);
          // Convert ! to ^ for negation in regex
          charClass = charClass.replace(/^\[!/, "[^");
          regex += charClass;
          i = j;
        }
        break;
      }
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
    return new RegExp(regex).test(str);
  } catch {
    return false;
  }
}
