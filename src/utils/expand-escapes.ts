export function expandEscapes(s: string): string {
  let result = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      i++;
      switch (s[i]) {
        case "n": result += "\n"; break;
        case "t": result += "\t"; break;
        case "\\": result += "\\"; break;
        case "a": result += "\x07"; break;
        case "b": result += "\b"; break;
        case "f": result += "\f"; break;
        case "r": result += "\r"; break;
        case "v": result += "\v"; break;
        default: result += s[i]; break;
      }
    } else {
      result += s[i];
    }
  }
  return result;
}
