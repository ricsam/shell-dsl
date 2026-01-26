const SHELL_SPECIAL_CHARS = /[|&;<>()$`\\\"' \t\n*?[\]#~=%]/;

export function escape(str: string): string {
  if (str === "") return "''";

  if (!SHELL_SPECIAL_CHARS.test(str)) {
    return str;
  }

  // Escape using single quotes, handling embedded single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

export function escapeForInterpolation(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = String(value);

  // Escape shell special characters
  return str.replace(/([|&;<>()$`\\\"' \t\n*?[\]#~=%])/g, "\\$1");
}
