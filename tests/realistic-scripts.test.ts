import { test, expect, describe, beforeEach } from "bun:test";
import { createFsFromVolume, Volume } from "memfs";
import { createShellDSL, createVirtualFS } from "../src/index.ts";
import { builtinCommands } from "../src/commands/index.ts";
import type { VirtualFS } from "../src/types.ts";

describe("Realistic Scripts", () => {
  let sh: ReturnType<typeof createShellDSL>;
  let fs: VirtualFS;
  let vol: InstanceType<typeof Volume>;

  beforeEach(async () => {
    vol = new Volume();
    vol.fromJSON({
      "/data/users.txt": "alice:admin\nbob:user\ncharlie:user\ndiana:admin\n",
      "/data/numbers.txt": "5\n3\n8\n1\n9\n2\n",
      "/data/log.txt": "INFO: Starting app\nERROR: Connection failed\nINFO: Retrying\nERROR: Timeout\nINFO: Success\n",
      "/scripts/.gitkeep": "",
      "/output/.gitkeep": "",
    });
    const memfs = createFsFromVolume(vol);
    fs = createVirtualFS(memfs);
    sh = createShellDSL({
      fs,
      cwd: "/",
      env: { HOME: "/home/user", USER: "testuser" },
      commands: builtinCommands,
    });
  });

  describe("File Processing Scripts", () => {
    test("process files and filter content", async () => {
      // Find all ERROR lines and count them
      const result = await sh`
        count=0
        for line in ERROR; do
          count=$((count + 1))
        done
        cat /data/log.txt | grep ERROR | wc -l
      `.text();
      expect(result.trim()).toBe("2");
    });

    test("conditional file processing", async () => {
      // Process file only if it exists
      const result = await sh`
        if test -f /data/users.txt; then
          cat /data/users.txt | grep admin | wc -l
        else
          echo "0"
        fi
      `.text();
      expect(result.trim()).toBe("2");
    });

    test("process multiple files with for loop", async () => {
      await fs.writeFile("/data/a.txt", "apple\n");
      await fs.writeFile("/data/b.txt", "banana\n");
      await fs.writeFile("/data/c.txt", "cherry\n");

      const result = await sh`
        for f in /data/a.txt /data/b.txt /data/c.txt; do
          if test -f "$f"; then
            cat "$f"
          fi
        done
      `.text();
      expect(result).toBe("apple\nbanana\ncherry\n");
    });

    test("transform and aggregate data", async () => {
      // Count admin users
      const result = await sh`
        admins=0
        for user in alice bob charlie diana; do
          line=$(cat /data/users.txt | grep "^$user:")
          if echo "$line" | grep -q admin; then
            admins=$((admins + 1))
          fi
        done
        echo $admins
      `.text();
      expect(result.trim()).toBe("2");
    });
  });

  describe("Argument Parsing Scripts", () => {
    test("case-based option parsing", async () => {
      // Simulate argument parsing
      const result = await sh`
        arg="--help"
        case $arg in
          -h|--help) echo "Usage: cmd [options]" ;;
          -v|--version) echo "1.0.0" ;;
          -q|--quiet) echo "quiet mode" ;;
          *) echo "Unknown option: $arg" ;;
        esac
      `.text();
      expect(result).toBe("Usage: cmd [options]\n");
    });

    test("multiple argument processing", async () => {
      const result = await sh`
        output=""
        for arg in --verbose file1.txt file2.txt; do
          case $arg in
            --verbose) output="$output[verbose] " ;;
            --quiet) output="$output[quiet] " ;;
            *.txt) output="$output$arg " ;;
            *) output="$output[unknown: $arg] " ;;
          esac
        done
        echo "$output"
      `.text();
      expect(result.trim()).toBe("[verbose] file1.txt file2.txt");
    });
  });

  describe("Counter Scripts", () => {
    test("countdown timer", async () => {
      const result = await sh`
        i=5
        while test $i -gt 0; do
          echo $i
          i=$((i - 1))
        done
        echo "Done!"
      `.text();
      expect(result).toBe("5\n4\n3\n2\n1\nDone!\n");
    });

    test("sum numbers", async () => {
      const result = await sh`
        sum=0
        for n in 1 2 3 4 5; do
          sum=$((sum + n))
        done
        echo $sum
      `.text();
      expect(result.trim()).toBe("15");
    });

    test("factorial calculation", async () => {
      const result = await sh`
        n=5
        fact=1
        while test $n -gt 1; do
          fact=$((fact * n))
          n=$((n - 1))
        done
        echo $fact
      `.text();
      expect(result.trim()).toBe("120");
    });

    test("fibonacci sequence", async () => {
      const result = await sh`
        a=0
        b=1
        count=0
        while test $count -lt 10; do
          echo $a
          temp=$((a + b))
          a=$b
          b=$temp
          count=$((count + 1))
        done
      `.text();
      const lines = result.trim().split("\n");
      expect(lines).toEqual(["0", "1", "1", "2", "3", "5", "8", "13", "21", "34"]);
    });
  });

  describe("Data Validation Scripts", () => {
    test("validate input type", async () => {
      // Simple validation using pattern matching
      const result = await sh`
        for value in yes no maybe; do
          case $value in
            yes|no) echo "$value: boolean" ;;
            *) echo "$value: unknown" ;;
          esac
        done
      `.text();
      const lines = result.trim().split("\n");
      expect(lines).toContain("yes: boolean");
      expect(lines).toContain("no: boolean");
      expect(lines).toContain("maybe: unknown");
    });

    test("check file existence and type", async () => {
      await fs.mkdir("/testdir");
      await fs.writeFile("/testfile.txt", "content");

      const result = await sh`
        for path in /testdir /testfile.txt /nonexistent; do
          if test -d "$path"; then
            echo "$path: directory"
          elif test -f "$path"; then
            echo "$path: file"
          else
            echo "$path: not found"
          fi
        done
      `.text();
      expect(result).toContain("/testdir: directory");
      expect(result).toContain("/testfile.txt: file");
      expect(result).toContain("/nonexistent: not found");
    });
  });

  describe("Pipeline Scripts", () => {
    test("complex pipeline with filtering and sorting", async () => {
      const result = await sh`
        cat /data/numbers.txt | sort -n | head -3
      `.text();
      expect(result).toBe("1\n2\n3\n");
    });

    test("pipeline in loop", async () => {
      const result = await sh`
        for pattern in ERROR INFO; do
          count=$(cat /data/log.txt | grep "$pattern" | wc -l)
          echo "$pattern: $count"
        done
      `.text();
      // wc output may have leading spaces, check for the numbers
      expect(result).toContain("ERROR:");
      expect(result).toContain("2");
      expect(result).toContain("INFO:");
      expect(result).toContain("3");
    });

    test("conditional pipeline execution", async () => {
      const result = await sh`
        if cat /data/log.txt | grep -q ERROR; then
          echo "Errors found"
          cat /data/log.txt | grep ERROR | head -1
        else
          echo "No errors"
        fi
      `.text();
      expect(result).toContain("Errors found");
      expect(result).toContain("ERROR: Connection failed");
    });
  });

  describe("Error Handling Scripts", () => {
    test("handle missing files gracefully", async () => {
      const result = await sh`
        for f in /data/users.txt /nonexistent.txt /data/log.txt; do
          if test -f "$f"; then
            echo "Processing $f"
          else
            echo "Skipping $f (not found)"
          fi
        done
      `.text();
      expect(result).toContain("Processing /data/users.txt");
      expect(result).toContain("Skipping /nonexistent.txt (not found)");
      expect(result).toContain("Processing /data/log.txt");
    });

    test("early exit on error", async () => {
      const result = await sh`
        for i in 1 2 3 4 5; do
          if test $i -eq 3; then
            echo "Error at $i"
            break
          fi
          echo "Step $i"
        done
        echo "Finished"
      `.text();
      expect(result).toBe("Step 1\nStep 2\nError at 3\nFinished\n");
    });

    test("skip invalid entries with continue", async () => {
      const result = await sh`
        for val in 1 skip 2 skip 3; do
          case $val in
            skip) continue ;;
          esac
          echo "Processing $val"
        done
      `.text();
      expect(result).toBe("Processing 1\nProcessing 2\nProcessing 3\n");
    });
  });

  describe("Text Processing Scripts", () => {
    test("word frequency counter", async () => {
      await fs.writeFile("/text.txt", "apple banana apple cherry banana apple");

      // Count occurrences of each fruit
      const result = await sh`
        for word in apple banana cherry; do
          count=$(cat /text.txt | grep -o "$word" | wc -l)
          echo "$word: $count"
        done
      `.text();
      // wc output may have leading spaces, check for key parts
      expect(result).toContain("apple:");
      expect(result).toContain("banana:");
      expect(result).toContain("cherry:");
      // Verify the counts appear (with possible leading spaces)
      expect(result).toMatch(/apple:\s*3/);
      expect(result).toMatch(/banana:\s*2/);
      expect(result).toMatch(/cherry:\s*1/);
    });

    test("line numbering", async () => {
      await fs.writeFile("/lines.txt", "first\nsecond\nthird\n");

      const result = await sh`
        n=1
        for line in first second third; do
          echo "$n: $line"
          n=$((n + 1))
        done
      `.text();
      expect(result).toBe("1: first\n2: second\n3: third\n");
    });
  });

  describe("Build Script Simulation", () => {
    test("simulated build process", async () => {
      const result = await sh`
        echo "Starting build..."

        # Clean phase
        echo "Cleaning..."
        if test -d /output; then
          echo "Output directory exists"
        fi

        # Build phase
        echo "Building..."
        for step in compile link package; do
          echo "  Step: $step"
        done

        # Test phase
        tests_passed=0
        total_tests=5
        i=1
        while test $i -le $total_tests; do
          tests_passed=$((tests_passed + 1))
          i=$((i + 1))
        done

        if test $tests_passed -eq $total_tests; then
          echo "All $total_tests tests passed!"
        else
          echo "Some tests failed"
        fi

        echo "Build complete!"
      `.text();

      expect(result).toContain("Starting build...");
      expect(result).toContain("Cleaning...");
      expect(result).toContain("Building...");
      expect(result).toContain("Step: compile");
      expect(result).toContain("Step: link");
      expect(result).toContain("Step: package");
      expect(result).toContain("All 5 tests passed!");
      expect(result).toContain("Build complete!");
    });
  });

  describe("Nested Control Flow", () => {
    test("multiplication table", async () => {
      const result = await sh`
        i=1
        while test $i -le 3; do
          j=1
          line=""
          while test $j -le 3; do
            product=$((i * j))
            line="$line $product"
            j=$((j + 1))
          done
          echo "$line"
          i=$((i + 1))
        done
      `.text();
      const lines = result.trim().split("\n");
      expect(lines[0]!.trim()).toBe("1 2 3");
      expect(lines[1]!.trim()).toBe("2 4 6");
      expect(lines[2]!.trim()).toBe("3 6 9");
    });

    test("nested loops with break", async () => {
      const result = await sh`
        for i in 1 2 3; do
          for j in a b c; do
            if test "$i" = "2" && test "$j" = "b"; then
              break
            fi
            echo "$i$j"
          done
        done
      `.text();
      expect(result).toBe("1a\n1b\n1c\n2a\n3a\n3b\n3c\n");
    });

    test("if inside while inside for", async () => {
      const result = await sh`
        for letter in x y; do
          count=1
          while test $count -le 2; do
            if test $count -eq 1; then
              echo "$letter: first"
            else
              echo "$letter: second"
            fi
            count=$((count + 1))
          done
        done
      `.text();
      const lines = result.trim().split("\n");
      expect(lines).toEqual([
        "x: first",
        "x: second",
        "y: first",
        "y: second",
      ]);
    });
  });
});
