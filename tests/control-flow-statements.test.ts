import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createShellDSL, createVirtualFS } from "../src/index.ts";
import { builtinCommands } from "../commands/index.ts";
import type { VirtualFS } from "../src/types.ts";

describe("Control Flow Statements", () => {
  let sh: ReturnType<typeof createShellDSL>;
  let fs: VirtualFS;
  let vol: InstanceType<typeof Volume>;

  beforeEach(async () => {
    vol = new Volume();
    vol.fromJSON({
      "/tmp/.gitkeep": "",
    });
    const memfs = createFsFromVolume(vol);
    fs = createVirtualFS(memfs);
    sh = createShellDSL({
      fs,
      cwd: "/",
      env: { HOME: "/home/user" },
      commands: builtinCommands,
    });
  });

  describe("if/then/fi", () => {
    test("basic if-then-fi (true condition)", async () => {
      const result = await sh`if true; then echo "yes"; fi`.text();
      expect(result).toBe("yes\n");
    });

    test("basic if-then-fi (false condition)", async () => {
      const result = await sh`if false; then echo "yes"; fi`.text();
      expect(result).toBe("");
    });

    test("if-then-else (true condition)", async () => {
      const result = await sh`if true; then echo "yes"; else echo "no"; fi`.text();
      expect(result).toBe("yes\n");
    });

    test("if-then-else (false condition)", async () => {
      const result = await sh`if false; then echo "yes"; else echo "no"; fi`.text();
      expect(result).toBe("no\n");
    });

    test("if with test command", async () => {
      const result = await sh`if test 5 -gt 3; then echo "greater"; fi`.text();
      expect(result).toBe("greater\n");
    });

    test("if with [ command", async () => {
      const result = await sh`if [ 5 -gt 3 ]; then echo "greater"; fi`.text();
      expect(result).toBe("greater\n");
    });

    test("if-elif-else", async () => {
      const result = await sh`
        if test 1 -eq 2; then
          echo "one"
        elif test 2 -eq 2; then
          echo "two"
        else
          echo "other"
        fi
      `.text();
      expect(result).toBe("two\n");
    });

    test("multiple elif branches", async () => {
      const result = await sh`
        if test 1 -eq 5; then
          echo "one"
        elif test 2 -eq 5; then
          echo "two"
        elif test 3 -eq 5; then
          echo "three"
        elif test 5 -eq 5; then
          echo "five"
        else
          echo "other"
        fi
      `.text();
      expect(result).toBe("five\n");
    });

    test("nested if statements", async () => {
      const result = await sh`
        if true; then
          if true; then
            echo "inner yes"
          fi
        fi
      `.text();
      expect(result).toBe("inner yes\n");
    });

    test("if with variable", async () => {
      const result = await sh`VAR=hello; if test "$VAR" = "hello"; then echo "match"; fi`.text();
      expect(result).toBe("match\n");
    });

    test("if with pipe in condition", async () => {
      await fs.writeFile("/test.txt", "hello\nworld\n");
      const result = await sh`if cat /test.txt | grep hello; then echo "found"; fi`.text();
      expect(result).toContain("found");
    });
  });

  describe("for loops", () => {
    test("basic for loop with literal items", async () => {
      const result = await sh`for i in a b c; do echo $i; done`.text();
      expect(result).toBe("a\nb\nc\n");
    });

    test("for loop with numbers", async () => {
      const result = await sh`for num in 1 2 3 4 5; do echo $num; done`.text();
      expect(result).toBe("1\n2\n3\n4\n5\n");
    });

    test("for loop with glob expansion", async () => {
      await fs.writeFile("/tmp/a.txt", "a");
      await fs.writeFile("/tmp/b.txt", "b");
      await fs.writeFile("/tmp/c.txt", "c");
      const result = await sh`for f in /tmp/*.txt; do echo $f; done`.text();
      expect(result).toContain("/tmp/a.txt");
      expect(result).toContain("/tmp/b.txt");
      expect(result).toContain("/tmp/c.txt");
    });

    test("for loop with command inside", async () => {
      await fs.writeFile("/tmp/test.txt", "content");
      const result = await sh`for f in /tmp/*.txt; do cat $f; done`.text();
      expect(result).toBe("content");
    });

    test("nested for loops", async () => {
      const result = await sh`
        for i in 1 2; do
          for j in a b; do
            echo "$i$j"
          done
        done
      `.text();
      expect(result).toBe("1a\n1b\n2a\n2b\n");
    });

    test("for loop with break", async () => {
      const result = await sh`
        for i in 1 2 3 4 5; do
          if test $i -eq 3; then break; fi
          echo $i
        done
      `.text();
      expect(result).toBe("1\n2\n");
    });

    test("for loop with continue", async () => {
      const result = await sh`
        for i in 1 2 3 4 5; do
          if test $i -eq 3; then continue; fi
          echo $i
        done
      `.text();
      expect(result).toBe("1\n2\n4\n5\n");
    });

    test("for loop with pipe in body", async () => {
      await fs.writeFile("/tmp/data.txt", "hello\nworld\n");
      const result = await sh`
        for word in hello world; do
          echo $word | cat
        done
      `.text();
      expect(result).toBe("hello\nworld\n");
    });
  });

  describe("while loops", () => {
    test("basic while loop", async () => {
      const result = await sh`
        i=1
        while test $i -le 3; do
          echo $i
          i=$((i + 1))
        done
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("while loop with break", async () => {
      const result = await sh`
        i=1
        while true; do
          echo $i
          i=$((i + 1))
          if test $i -gt 3; then break; fi
        done
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("while loop with continue", async () => {
      const result = await sh`
        i=0
        while test $i -lt 5; do
          i=$((i + 1))
          if test $i -eq 3; then continue; fi
          echo $i
        done
      `.text();
      expect(result).toBe("1\n2\n4\n5\n");
    });

    test("while loop with false condition never executes", async () => {
      const result = await sh`
        while false; do
          echo "never"
        done
      `.text();
      expect(result).toBe("");
    });

    test("nested while loops", async () => {
      const result = await sh`
        i=1
        while test $i -le 2; do
          j=1
          while test $j -le 2; do
            echo "$i,$j"
            j=$((j + 1))
          done
          i=$((i + 1))
        done
      `.text();
      expect(result).toBe("1,1\n1,2\n2,1\n2,2\n");
    });
  });

  describe("until loops", () => {
    test("basic until loop", async () => {
      const result = await sh`
        i=1
        until test $i -gt 3; do
          echo $i
          i=$((i + 1))
        done
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("until loop with true condition never executes", async () => {
      const result = await sh`
        until true; do
          echo "never"
        done
      `.text();
      expect(result).toBe("");
    });

    test("until with break", async () => {
      const result = await sh`
        i=1
        until false; do
          echo $i
          i=$((i + 1))
          if test $i -gt 3; then break; fi
        done
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });
  });

  describe("case statements", () => {
    test("basic case statement", async () => {
      const result = await sh`
        VAR=hello
        case $VAR in
          hello) echo "matched hello" ;;
          world) echo "matched world" ;;
        esac
      `.text();
      expect(result).toBe("matched hello\n");
    });

    test("case with wildcard pattern", async () => {
      const result = await sh`
        VAR=testing
        case $VAR in
          test*) echo "starts with test" ;;
          *) echo "other" ;;
        esac
      `.text();
      expect(result).toBe("starts with test\n");
    });

    test("case with default pattern", async () => {
      const result = await sh`
        VAR=unknown
        case $VAR in
          hello) echo "hello" ;;
          world) echo "world" ;;
          *) echo "default" ;;
        esac
      `.text();
      expect(result).toBe("default\n");
    });

    test("case with multiple patterns", async () => {
      const result = await sh`
        VAR=yes
        case $VAR in
          y|yes|Y|YES) echo "affirmative" ;;
          n|no|N|NO) echo "negative" ;;
          *) echo "unknown" ;;
        esac
      `.text();
      expect(result).toBe("affirmative\n");
    });

    test("case with question mark pattern", async () => {
      const result = await sh`
        VAR=cat
        case $VAR in
          c?t) echo "matched c?t" ;;
          *) echo "no match" ;;
        esac
      `.text();
      expect(result).toBe("matched c?t\n");
    });

    test("case with multiple commands in body", async () => {
      const result = await sh`
        VAR=test
        case $VAR in
          test)
            echo "line1"
            echo "line2"
            ;;
        esac
      `.text();
      expect(result).toBe("line1\nline2\n");
    });

    test("case with no match", async () => {
      const result = await sh`
        VAR=nomatch
        case $VAR in
          hello) echo "hello" ;;
          world) echo "world" ;;
        esac
      `.text();
      expect(result).toBe("");
    });
  });

  describe("arithmetic expansion", () => {
    test("basic addition", async () => {
      const result = await sh`echo $((1 + 2))`.text();
      expect(result).toBe("3\n");
    });

    test("subtraction", async () => {
      const result = await sh`echo $((10 - 3))`.text();
      expect(result).toBe("7\n");
    });

    test("multiplication", async () => {
      const result = await sh`echo $((4 * 5))`.text();
      expect(result).toBe("20\n");
    });

    test("division", async () => {
      const result = await sh`echo $((20 / 4))`.text();
      expect(result).toBe("5\n");
    });

    test("modulo", async () => {
      const result = await sh`echo $((17 % 5))`.text();
      expect(result).toBe("2\n");
    });

    test("arithmetic with variables", async () => {
      const result = await sh`x=10; y=3; echo $((x + y))`.text();
      expect(result).toBe("13\n");
    });

    test("arithmetic with $VAR syntax", async () => {
      const result = await sh`x=5; echo $(($x * 2))`.text();
      expect(result).toBe("10\n");
    });

    test("nested arithmetic", async () => {
      const result = await sh`echo $(((2 + 3) * 4))`.text();
      expect(result).toBe("20\n");
    });

    test("comparison operators", async () => {
      const result = await sh`echo $((5 > 3))`.text();
      expect(result).toBe("1\n");

      const result2 = await sh`echo $((5 < 3))`.text();
      expect(result2).toBe("0\n");

      const result3 = await sh`echo $((5 == 5))`.text();
      expect(result3).toBe("1\n");

      const result4 = await sh`echo $((5 != 5))`.text();
      expect(result4).toBe("0\n");
    });

    test("decrement in loop", async () => {
      const result = await sh`
        i=3
        while test $i -gt 0; do
          echo $i
          i=$((i - 1))
        done
      `.text();
      expect(result).toBe("3\n2\n1\n");
    });

    test("increment in loop", async () => {
      const result = await sh`
        i=1
        while test $i -le 3; do
          echo $i
          i=$((i + 1))
        done
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });
  });

  describe("combined control flow", () => {
    test("for inside if", async () => {
      const result = await sh`
        if true; then
          for i in a b c; do
            echo $i
          done
        fi
      `.text();
      expect(result).toBe("a\nb\nc\n");
    });

    test("if inside for", async () => {
      const result = await sh`
        for i in 1 2 3 4 5; do
          if test $((i % 2)) -eq 0; then
            echo "$i is even"
          fi
        done
      `.text();
      expect(result).toBe("2 is even\n4 is even\n");
    });

    test("while inside for", async () => {
      const result = await sh`
        for letter in a b; do
          i=1
          while test $i -le 2; do
            echo "$letter$i"
            i=$((i + 1))
          done
        done
      `.text();
      expect(result).toBe("a1\na2\nb1\nb2\n");
    });

    test("case inside for", async () => {
      const result = await sh`
        for item in apple banana cherry; do
          case $item in
            apple) echo "fruit: $item (red)" ;;
            banana) echo "fruit: $item (yellow)" ;;
            *) echo "fruit: $item (unknown color)" ;;
          esac
        done
      `.text();
      expect(result).toBe("fruit: apple (red)\nfruit: banana (yellow)\nfruit: cherry (unknown color)\n");
    });

    test("control flow with pipes", async () => {
      const result = await sh`
        for i in 1 2 3; do
          echo "line $i"
        done | grep "line 2"
      `.text();
      expect(result).toBe("line 2\n");
    });

    test("control flow with redirects", async () => {
      // Note: Redirects on compound commands (like `done > file`) aren't supported yet.
      // Use a workaround with echo -n and explicit redirection in loop body.
      await sh`
        for i in 1 2 3; do
          echo $i >> /tmp/output.txt
        done
      `;
      const content = await fs.readFile("/tmp/output.txt");
      expect(content.toString()).toBe("1\n2\n3\n");
    });
  });

  describe("edge cases", () => {
    test("empty for loop body", async () => {
      const result = await sh`for i in a b c; do true; done`.text();
      expect(result).toBe("");
    });

    test("empty while loop body", async () => {
      const result = await sh`
        i=3
        while test $i -gt 0; do
          i=$((i - 1))
        done
      `.text();
      expect(result).toBe("");
    });

    test("for loop with single item", async () => {
      const result = await sh`for i in only; do echo $i; done`.text();
      expect(result).toBe("only\n");
    });

    test("deeply nested loops", async () => {
      const result = await sh`
        for i in 1 2; do
          for j in a b; do
            for k in x y; do
              echo "$i$j$k"
            done
          done
        done
      `.text();
      const lines = result.trim().split("\n");
      expect(lines.length).toBe(8);
      expect(lines[0]).toBe("1ax");
      expect(lines[7]).toBe("2by");
    });

    test("break out of nested loop (one level)", async () => {
      const result = await sh`
        for i in 1 2 3; do
          for j in a b c; do
            if test $j = b; then break; fi
            echo "$i$j"
          done
        done
      `.text();
      expect(result).toBe("1a\n2a\n3a\n");
    });

    test("if with && and || in body", async () => {
      const result = await sh`
        if true; then
          true && echo "and works"
          false || echo "or works"
        fi
      `.text();
      expect(result).toBe("and works\nor works\n");
    });
  });
});
