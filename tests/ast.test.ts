import { test, expect, describe } from "bun:test";
import {
  isWordNode,
  isCommandNode,
  isPipelineNode,
  isAndNode,
  isOrNode,
  isSequenceNode,
  isIfNode,
  isForNode,
  isWhileNode,
  isUntilNode,
  isCaseNode,
  type ASTNode,
  type CommandNode,
  type PipelineNode,
  type AndNode,
  type OrNode,
  type SequenceNode,
  type WordNode,
  type IfNode,
  type ForNode,
  type WhileNode,
  type UntilNode,
  type CaseNode,
} from "../src/parser/ast.ts";

const textWord = (value: string, quoted = false): WordNode => ({
  type: "word",
  parts: value === "" && !quoted ? [] : [{ type: "text", value, quoted }],
});

describe("AST type guards", () => {
  const commandNode: CommandNode = {
    type: "command",
    name: textWord("echo"),
    args: [],
    redirects: [],
    assignments: [],
  };

  const pipelineNode: PipelineNode = {
    type: "pipeline",
    commands: [commandNode],
  };

  const andNode: AndNode = {
    type: "and",
    left: commandNode,
    right: commandNode,
  };

  const orNode: OrNode = {
    type: "or",
    left: commandNode,
    right: commandNode,
  };

  const sequenceNode: SequenceNode = {
    type: "sequence",
    commands: [commandNode],
  };

  const wordNode: WordNode = {
    type: "word",
    parts: [
      { type: "text", value: "hello ", quoted: false },
      { type: "variable", name: "USER", quoted: false },
    ],
  };

  const ifNode: IfNode = {
    type: "if",
    condition: commandNode,
    thenBranch: commandNode,
    elifBranches: [],
  };

  const forNode: ForNode = {
    type: "for",
    variable: "i",
    items: [textWord("item")],
    body: commandNode,
  };

  const whileNode: WhileNode = {
    type: "while",
    condition: commandNode,
    body: commandNode,
  };

  const untilNode: UntilNode = {
    type: "until",
    condition: commandNode,
    body: commandNode,
  };

  const caseNode: CaseNode = {
    type: "case",
    word: textWord("value"),
    clauses: [],
  };

  const allNodes: ASTNode[] = [
    commandNode,
    pipelineNode,
    andNode,
    orNode,
    sequenceNode,
    ifNode,
    forNode,
    whileNode,
    untilNode,
    caseNode,
  ];

  test("isWordNode returns true for shell words", () => {
    expect(isWordNode(wordNode)).toBe(true);
  });

  test("isCommandNode identifies commands", () => {
    expect(isCommandNode(commandNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "command") {
        expect(isCommandNode(node)).toBe(false);
      }
    }
  });

  test("isPipelineNode identifies pipelines", () => {
    expect(isPipelineNode(pipelineNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "pipeline") {
        expect(isPipelineNode(node)).toBe(false);
      }
    }
  });

  test("isAndNode identifies and nodes", () => {
    expect(isAndNode(andNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "and") {
        expect(isAndNode(node)).toBe(false);
      }
    }
  });

  test("isOrNode identifies or nodes", () => {
    expect(isOrNode(orNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "or") {
        expect(isOrNode(node)).toBe(false);
      }
    }
  });

  test("isSequenceNode identifies sequences", () => {
    expect(isSequenceNode(sequenceNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "sequence") {
        expect(isSequenceNode(node)).toBe(false);
      }
    }
  });

  test("isIfNode identifies if nodes", () => {
    expect(isIfNode(ifNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "if") {
        expect(isIfNode(node)).toBe(false);
      }
    }
  });

  test("isForNode identifies for nodes", () => {
    expect(isForNode(forNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "for") {
        expect(isForNode(node)).toBe(false);
      }
    }
  });

  test("isWhileNode identifies while nodes", () => {
    expect(isWhileNode(whileNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "while") {
        expect(isWhileNode(node)).toBe(false);
      }
    }
  });

  test("isUntilNode identifies until nodes", () => {
    expect(isUntilNode(untilNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "until") {
        expect(isUntilNode(node)).toBe(false);
      }
    }
  });

  test("isCaseNode identifies case nodes", () => {
    expect(isCaseNode(caseNode)).toBe(true);
    for (const node of allNodes) {
      if (node.type !== "case") {
        expect(isCaseNode(node)).toBe(false);
      }
    }
  });
});
