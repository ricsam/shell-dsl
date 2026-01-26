import { test, expect, describe } from "bun:test";
import {
  isCommandNode,
  isPipelineNode,
  isAndNode,
  isOrNode,
  isSequenceNode,
  isLiteralNode,
  isVariableNode,
  isSubstitutionNode,
  isGlobNode,
  isConcatNode,
  isIfNode,
  isForNode,
  isWhileNode,
  isUntilNode,
  isCaseNode,
  isArithmeticNode,
  type ASTNode,
  type CommandNode,
  type PipelineNode,
  type AndNode,
  type OrNode,
  type SequenceNode,
  type LiteralNode,
  type VariableNode,
  type SubstitutionNode,
  type GlobNode,
  type ConcatNode,
  type IfNode,
  type ForNode,
  type WhileNode,
  type UntilNode,
  type CaseNode,
  type ArithmeticNode,
} from "../src/parser/ast.ts";

describe("AST type guards", () => {
  const commandNode: CommandNode = {
    type: "command",
    name: { type: "literal", value: "echo" },
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

  const literalNode: LiteralNode = {
    type: "literal",
    value: "hello",
  };

  const variableNode: VariableNode = {
    type: "variable",
    name: "HOME",
  };

  const substitutionNode: SubstitutionNode = {
    type: "substitution",
    command: commandNode,
  };

  const globNode: GlobNode = {
    type: "glob",
    pattern: "*.txt",
  };

  const concatNode: ConcatNode = {
    type: "concat",
    parts: [literalNode, variableNode],
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
    items: [literalNode],
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
    word: literalNode,
    clauses: [],
  };

  const arithmeticNode: ArithmeticNode = {
    type: "arithmetic",
    expression: "1 + 2",
  };

  const allNodes: ASTNode[] = [
    commandNode,
    pipelineNode,
    andNode,
    orNode,
    sequenceNode,
    literalNode,
    variableNode,
    substitutionNode,
    globNode,
    concatNode,
    ifNode,
    forNode,
    whileNode,
    untilNode,
    caseNode,
    arithmeticNode,
  ];

  describe("isCommandNode", () => {
    test("returns true for command node", () => {
      expect(isCommandNode(commandNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "command") {
          expect(isCommandNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isPipelineNode", () => {
    test("returns true for pipeline node", () => {
      expect(isPipelineNode(pipelineNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "pipeline") {
          expect(isPipelineNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isAndNode", () => {
    test("returns true for and node", () => {
      expect(isAndNode(andNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "and") {
          expect(isAndNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isOrNode", () => {
    test("returns true for or node", () => {
      expect(isOrNode(orNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "or") {
          expect(isOrNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isSequenceNode", () => {
    test("returns true for sequence node", () => {
      expect(isSequenceNode(sequenceNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "sequence") {
          expect(isSequenceNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isLiteralNode", () => {
    test("returns true for literal node", () => {
      expect(isLiteralNode(literalNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "literal") {
          expect(isLiteralNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isVariableNode", () => {
    test("returns true for variable node", () => {
      expect(isVariableNode(variableNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "variable") {
          expect(isVariableNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isSubstitutionNode", () => {
    test("returns true for substitution node", () => {
      expect(isSubstitutionNode(substitutionNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "substitution") {
          expect(isSubstitutionNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isGlobNode", () => {
    test("returns true for glob node", () => {
      expect(isGlobNode(globNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "glob") {
          expect(isGlobNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isConcatNode", () => {
    test("returns true for concat node", () => {
      expect(isConcatNode(concatNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "concat") {
          expect(isConcatNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isIfNode", () => {
    test("returns true for if node", () => {
      expect(isIfNode(ifNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "if") {
          expect(isIfNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isForNode", () => {
    test("returns true for for node", () => {
      expect(isForNode(forNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "for") {
          expect(isForNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isWhileNode", () => {
    test("returns true for while node", () => {
      expect(isWhileNode(whileNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "while") {
          expect(isWhileNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isUntilNode", () => {
    test("returns true for until node", () => {
      expect(isUntilNode(untilNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "until") {
          expect(isUntilNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isCaseNode", () => {
    test("returns true for case node", () => {
      expect(isCaseNode(caseNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "case") {
          expect(isCaseNode(node)).toBe(false);
        }
      }
    });
  });

  describe("isArithmeticNode", () => {
    test("returns true for arithmetic node", () => {
      expect(isArithmeticNode(arithmeticNode)).toBe(true);
    });

    test("returns false for other node types", () => {
      for (const node of allNodes) {
        if (node.type !== "arithmetic") {
          expect(isArithmeticNode(node)).toBe(false);
        }
      }
    });
  });
});
