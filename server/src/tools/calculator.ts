import { z } from "zod";
import { defineTool } from "./define.js";

export const calculatorInput = z.object({
  expression: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("Arithmetic expression using +, -, *, /, parentheses, and decimals"),
});

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

export function evaluateExpression(expression: string): number {
  const parser = new Parser(expression);
  const value = parser.parseExpression();
  if (!parser.isDone()) {
    throw new ExpressionError(
      `Unexpected character at position ${parser.position() + 1}`,
    );
  }
  if (!Number.isFinite(value)) {
    throw new ExpressionError("Result is not a finite number");
  }
  return Number(value.toPrecision(12));
}

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      if (this.consume("+")) value += this.parseTerm();
      else if (this.consume("-")) value -= this.parseTerm();
      else return value;
    }
  }

  isDone(): boolean {
    this.skip();
    return this.index >= this.source.length;
  }

  position(): number {
    this.skip();
    return this.index;
  }

  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      if (this.consume("*")) value *= this.parseFactor();
      else if (this.consume("/")) {
        const divisor = this.parseFactor();
        if (divisor === 0) throw new ExpressionError("Division by zero");
        value /= divisor;
      } else return value;
    }
  }

  private parseFactor(): number {
    this.skip();
    if (this.consume("+")) return this.parseFactor();
    if (this.consume("-")) return -this.parseFactor();
    if (this.consume("(")) {
      const value = this.parseExpression();
      if (!this.consume(")")) throw new ExpressionError("Expected ')'");
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skip();
    const start = this.index;
    while (this.isDigit(this.peek())) this.index += 1;
    if (this.peek() === ".") {
      this.index += 1;
      const fraction = this.index;
      while (this.isDigit(this.peek())) this.index += 1;
      if (this.index === fraction) {
        throw new ExpressionError("Expected digits after the decimal point");
      }
    }
    if (this.index === start) {
      throw new ExpressionError(`Expected a number at position ${start + 1}`);
    }
    const raw = this.source.slice(start, this.index);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new ExpressionError(`Invalid number ${raw}`);
    return value;
  }

  private consume(token: string): boolean {
    this.skip();
    if (!this.source.startsWith(token, this.index)) return false;
    this.index += token.length;
    return true;
  }

  private skip(): void {
    while (this.peek() === " " || this.peek() === "\t") this.index += 1;
  }

  private peek(): string {
    return this.source[this.index] ?? "";
  }

  private isDigit(char: string): boolean {
    return char >= "0" && char <= "9";
  }
}

export const calculatorTool = defineTool({
  name: "calculate",
  description:
    "Evaluate an arithmetic expression. Supports +, -, *, /, parentheses, decimals, and unary minus. Does not evaluate JavaScript.",
  schema: calculatorInput,
  execute: (input) => ({
    expression: input.expression,
    result: evaluateExpression(input.expression),
  }),
});
