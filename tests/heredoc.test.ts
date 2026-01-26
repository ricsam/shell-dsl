import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createVirtualFS, createShellDSL } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";
import { lex } from "../src/lexer/index.ts";
import { parse } from "../src/parser/index.ts";

describe("Heredoc", () => {
  describe("Lexer", () => {
    test("tokenizes basic heredoc", () => {
      const tokens = lex("cat <<EOF\nhello world\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "hello world\n", expand: true },
        { type: "eof" },
      ]);
    });

    test("tokenizes heredoc with quoted delimiter (single quotes - no expansion)", () => {
      const tokens = lex("cat <<'EOF'\nhello $USER\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "hello $USER\n", expand: false },
        { type: "eof" },
      ]);
    });

    test("tokenizes heredoc with quoted delimiter (double quotes - no expansion)", () => {
      const tokens = lex('cat <<"EOF"\nhello $USER\nEOF');
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "hello $USER\n", expand: false },
        { type: "eof" },
      ]);
    });

    test("tokenizes tab-stripping heredoc (<<-)", () => {
      const tokens = lex("cat <<-EOF\n\t\tindented\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "indented\n", expand: true },
        { type: "eof" },
      ]);
    });

    test("tokenizes heredoc with custom delimiter", () => {
      const tokens = lex("cat <<MYDELIM\ncontent\nMYDELIM");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "content\n", expand: true },
        { type: "eof" },
      ]);
    });

    test("tokenizes heredoc with pipe on same line", () => {
      const tokens = lex("cat <<EOF | grep hello\nhello world\ngoodbye world\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "hello world\ngoodbye world\n", expand: true },
        { type: "pipe" },
        { type: "word", value: "grep" },
        { type: "word", value: "hello" },
        { type: "eof" },
      ]);
    });

    test("tokenizes heredoc with multiple commands after", () => {
      const tokens = lex("cat <<EOF | grep foo | wc -l\nfoo bar\nfoo baz\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "foo bar\nfoo baz\n", expand: true },
        { type: "pipe" },
        { type: "word", value: "grep" },
        { type: "word", value: "foo" },
        { type: "pipe" },
        { type: "word", value: "wc" },
        { type: "word", value: "-l" },
        { type: "eof" },
      ]);
    });

    test("tokenizes empty heredoc", () => {
      const tokens = lex("cat <<EOF\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "", expand: true },
        { type: "eof" },
      ]);
    });

    test("preserves special characters in heredoc content", () => {
      const tokens = lex("cat <<EOF\n* ? [ ] { } | ; < >\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "* ? [ ] { } | ; < >\n", expand: true },
        { type: "eof" },
      ]);
    });

    test("delimiter is case-sensitive", () => {
      const tokens = lex("cat <<EOF\nEof\neof\nEOF");
      expect(tokens).toEqual([
        { type: "word", value: "cat" },
        { type: "heredoc", content: "Eof\neof\n", expand: true },
        { type: "eof" },
      ]);
    });
  });

  describe("Parser", () => {
    test("parses heredoc as input redirect", () => {
      const tokens = lex("cat <<EOF\nhello\nEOF");
      const ast = parse(tokens);
      expect(ast.type).toBe("command");
      if (ast.type === "command") {
        expect(ast.redirects).toHaveLength(1);
        expect(ast.redirects[0]!.mode).toBe("<");
        expect(ast.redirects[0]!.heredocContent).toBe(true);
      }
    });

    test("parses heredoc with variable expansion in AST", () => {
      const tokens = lex("cat <<EOF\nhello $USER\nEOF");
      const ast = parse(tokens);
      if (ast.type === "command") {
        const target = ast.redirects[0]!.target;
        expect(target.type).toBe("concat");
        if (target.type === "concat") {
          expect(target.parts).toHaveLength(3);
          expect(target.parts[0]).toEqual({ type: "literal", value: "hello " });
          expect(target.parts[1]).toEqual({ type: "variable", name: "USER" });
          expect(target.parts[2]).toEqual({ type: "literal", value: "\n" });
        }
      }
    });

    test("parses heredoc with ${VAR} syntax", () => {
      const tokens = lex("cat <<EOF\nhello ${USER}!\nEOF");
      const ast = parse(tokens);
      if (ast.type === "command") {
        const target = ast.redirects[0]!.target;
        expect(target.type).toBe("concat");
        if (target.type === "concat") {
          expect(target.parts).toHaveLength(3);
          expect(target.parts[0]).toEqual({ type: "literal", value: "hello " });
          expect(target.parts[1]).toEqual({ type: "variable", name: "USER" });
          expect(target.parts[2]).toEqual({ type: "literal", value: "!\n" });
        }
      }
    });

    test("parses heredoc with no expansion (quoted delimiter)", () => {
      const tokens = lex("cat <<'EOF'\nhello $USER\nEOF");
      const ast = parse(tokens);
      if (ast.type === "command") {
        const target = ast.redirects[0]!.target;
        expect(target.type).toBe("literal");
        if (target.type === "literal") {
          expect(target.value).toBe("hello $USER\n");
        }
      }
    });

    test("parses heredoc piped to another command", () => {
      const tokens = lex("cat <<EOF | grep hello\nhello world\nEOF");
      const ast = parse(tokens);
      expect(ast.type).toBe("pipeline");
      if (ast.type === "pipeline") {
        expect(ast.commands).toHaveLength(2);
        expect(ast.commands[0]!.type).toBe("command");
        expect(ast.commands[1]!.type).toBe("command");
      }
    });
  });

  describe("Interpreter", () => {
    let vol: InstanceType<typeof Volume>;
    let sh: ReturnType<typeof createShellDSL>;

    beforeEach(() => {
      vol = new Volume();
      const memfs = createFsFromVolume(vol);
      const fs = createVirtualFS(memfs);

      sh = createShellDSL({
        fs,
        cwd: "/",
        env: { USER: "alice", HOME: "/home/alice" },
        commands: builtinCommands,
      });
    });

    test("basic heredoc feeds stdin to cat", async () => {
      const result = await sh`cat <<EOF
hello world
EOF`.text();
      expect(result).toBe("hello world\n");
    });

    test("multi-line heredoc content", async () => {
      const result = await sh`cat <<EOF
line 1
line 2
line 3
EOF`.text();
      expect(result).toBe("line 1\nline 2\nline 3\n");
    });

    test("variable expansion with $VAR", async () => {
      const result = await sh`cat <<EOF
Hello, $USER!
EOF`.text();
      expect(result).toBe("Hello, alice!\n");
    });

    test("variable expansion with \\${VAR}", async () => {
      const result = await sh`cat <<EOF
Hello, \${USER}!
EOF`.text();
      expect(result).toBe("Hello, alice!\n");
    });

    test("quoted delimiter disables variable expansion (single quotes)", async () => {
      const result = await sh`cat <<'EOF'
Hello, $USER!
EOF`.text();
      expect(result).toBe("Hello, $USER!\n");
    });

    test("quoted delimiter disables variable expansion (double quotes)", async () => {
      const result = await sh`cat <<"EOF"
Hello, $USER!
EOF`.text();
      expect(result).toBe("Hello, $USER!\n");
    });

    test("tab-stripping heredoc (<<-)", async () => {
      const result = await sh`cat <<-EOF
		indented content
		more indented
EOF`.text();
      expect(result).toBe("indented content\nmore indented\n");
    });

    test("heredoc piped to grep", async () => {
      const result = await sh`cat <<EOF | grep hello
hello world
goodbye world
hello again
EOF`.text();
      expect(result).toBe("hello world\nhello again\n");
    });

    test("heredoc piped to wc -l", async () => {
      const result = await sh`cat <<EOF | wc -l
line 1
line 2
line 3
EOF`.text();
      expect(result.trim()).toBe("3");
    });

    test("empty heredoc", async () => {
      const result = await sh`cat <<EOF
EOF`.text();
      expect(result).toBe("");
    });

    test("special characters preserved in heredoc", async () => {
      const result = await sh`cat <<EOF
* ? [ ] { } | ; < >
EOF`.text();
      expect(result).toBe("* ? [ ] { } | ; < >\n");
    });

    test("case-sensitive delimiter", async () => {
      const result = await sh`cat <<EOF
Eof
eof
EOF`.text();
      expect(result).toBe("Eof\neof\n");
    });

    test("custom delimiter", async () => {
      const result = await sh`cat <<MYMARKER
custom content
MYMARKER`.text();
      expect(result).toBe("custom content\n");
    });

    test("multiple variables in heredoc", async () => {
      const result = await sh`cat <<EOF
User: $USER
Home: $HOME
EOF`.text();
      expect(result).toBe("User: alice\nHome: /home/alice\n");
    });

    test("heredoc with grep filter", async () => {
      const result = await sh`cat <<EOF | grep foo
foo bar
baz qux
foo baz
EOF`.text();
      expect(result).toBe("foo bar\nfoo baz\n");
    });

    test("heredoc in pipeline with multiple stages", async () => {
      const result = await sh`cat <<EOF | grep foo | wc -l
foo 1
bar 2
foo 3
baz 4
EOF`.text();
      expect(result.trim()).toBe("2");
    });

    test("preserves blank lines", async () => {
      const result = await sh`cat <<EOF
line 1

line 3
EOF`.text();
      expect(result).toBe("line 1\n\nline 3\n");
    });

    test("preserves leading whitespace (without <<-)", async () => {
      const result = await sh`cat <<EOF
  indented
    more indented
EOF`.text();
      expect(result).toBe("  indented\n    more indented\n");
    });
  });
});
