// Purely structural OpenSCAD parser. No expression grammar: expressions are
// treated as opaque, balanced-bracket-respecting spans. See the plan this
// implements for the scope rationale (module/function/variable declarations,
// their parameter lists, and call sites — nothing else).

export type ScadPosition = {
  line: number; // 0-based
  col: number; // 0-based
};

export type ScadRange = {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
};

export type SymbolKind = 'module' | 'function' | 'variable';

export type ScadParam = {
  name: string;
  defaultText: string | null;
};

export type ScadSymbol = {
  kind: SymbolKind;
  name: string;
  nameRange: ScadRange;
  params: ScadParam[] | null; // null for variables
  valueText: string | null; // function body / variable value, raw text (null for modules)
};

export type CallSite = {
  name: string;
  nameRange: ScadRange;
};

export type DiagnosticSeverity = 'error' | 'warning';

export type ScadDiagnostic = {
  severity: DiagnosticSeverity;
  message: string;
  range: ScadRange;
};

export type ParseResult = {
  symbols: ScadSymbol[];
  symbolsByName: Map<string, ScadSymbol[]>;
  callSites: CallSite[];
  diagnostics: ScadDiagnostic[];
};

type TokenType = 'ident' | 'number' | 'string' | 'bracket' | 'punct' | 'op';

type Token = {
  type: TokenType;
  text: string;
  start: ScadPosition;
  end: ScadPosition;
};

// Statement-leading keywords: never treated as a call even when followed by
// '(', so a modifier chain like `translate(v) if (cond) cube(1);` hands the
// `if` back to parseStatement's own dispatch instead of registering it as a
// call site.
const STATEMENT_KEYWORDS = new Set(['if', 'for', 'intersection_for', 'module', 'function', 'include', 'use']);

// Keywords that can appear as `keyword (...)` inside an expression (list
// comprehensions, let-expressions) — never call sites, even though they're
// followed by '(' just like a real call would be.
const EXPRESSION_KEYWORDS = new Set(['for', 'if', 'let', 'each']);

const OPEN_BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSE_BRACKETS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const IDENT_START = /[a-zA-Z_$]/;
const IDENT_CONT = /[a-zA-Z0-9_]/;

function isIdentStart(ch: string): boolean {
  return IDENT_START.test(ch);
}

function isIdentCont(ch: string): boolean {
  return IDENT_CONT.test(ch);
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

class Lexer {
  private readonly src: string;
  private pos = 0;
  private line = 0;
  private col = 0;
  readonly diagnostics: ScadDiagnostic[] = [];

  constructor(src: string) {
    this.src = src;
  }

  private here(): ScadPosition {
    return { line: this.line, col: this.col };
  }

  private advance(): string {
    const ch = this.src[this.pos];
    this.pos++;
    if (ch === '\n') {
      this.line++;
      this.col = 0;
    } else {
      this.col++;
    }
    return ch;
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.pos + offset];
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.pos < this.src.length) {
      const ch = this.peek();
      if (ch === undefined) break;

      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      if (ch === '/' && this.peek(1) === '/') {
        while (this.pos < this.src.length && this.peek() !== '\n') this.advance();
        continue;
      }

      if (ch === '/' && this.peek(1) === '*') {
        const start = this.here();
        this.advance();
        this.advance();
        let closed = false;
        while (this.pos < this.src.length) {
          if (this.peek() === '*' && this.peek(1) === '/') {
            this.advance();
            this.advance();
            closed = true;
            break;
          }
          this.advance();
        }
        if (!closed) {
          this.diagnostics.push({
            severity: 'error',
            message: 'Unterminated block comment',
            range: { startLine: start.line, startCol: start.col, endLine: this.line, endCol: this.col },
          });
        }
        continue;
      }

      if (ch === '"') {
        const start = this.here();
        this.advance();
        let closed = false;
        let text = '"';
        while (this.pos < this.src.length) {
          const c = this.peek();
          if (c === '\\') {
            text += this.advance();
            if (this.pos < this.src.length) text += this.advance();
            continue;
          }
          if (c === '"') {
            text += this.advance();
            closed = true;
            break;
          }
          if (c === '\n') break;
          text += this.advance();
        }
        if (!closed) {
          this.diagnostics.push({
            severity: 'error',
            message: 'Unterminated string literal',
            range: { startLine: start.line, startCol: start.col, endLine: this.line, endCol: this.col },
          });
        }
        tokens.push({ type: 'string', text, start, end: this.here() });
        continue;
      }

      if (isDigit(ch) || (ch === '.' && this.peek(1) !== undefined && isDigit(this.peek(1)!))) {
        const start = this.here();
        let text = '';
        while (this.pos < this.src.length && isDigit(this.peek()!)) text += this.advance();
        if (this.peek() === '.') {
          text += this.advance();
          while (this.pos < this.src.length && isDigit(this.peek()!)) text += this.advance();
        }
        if (this.peek() === 'e' || this.peek() === 'E') {
          text += this.advance();
          const sign = this.peek();
          if (sign === '+' || sign === '-') text += this.advance();
          while (this.pos < this.src.length && isDigit(this.peek()!)) text += this.advance();
        }
        tokens.push({ type: 'number', text, start, end: this.here() });
        continue;
      }

      if (isIdentStart(ch)) {
        const start = this.here();
        let text = this.advance();
        while (this.pos < this.src.length && isIdentCont(this.peek()!)) text += this.advance();
        tokens.push({ type: 'ident', text, start, end: this.here() });
        continue;
      }

      if (ch in OPEN_BRACKETS || ch in CLOSE_BRACKETS) {
        const start = this.here();
        this.advance();
        tokens.push({ type: 'bracket', text: ch, start, end: this.here() });
        continue;
      }

      if (ch === ',' || ch === ';') {
        const start = this.here();
        this.advance();
        tokens.push({ type: 'punct', text: ch, start, end: this.here() });
        continue;
      }

      // Everything else (operators, '=', '<', '>', etc.) is a single-char op token.
      // Multi-char operators don't matter here since we never evaluate expressions.
      {
        const start = this.here();
        const text = this.advance();
        tokens.push({ type: 'op', text, start, end: this.here() });
      }
    }
    return tokens;
  }
}

class Parser {
  private readonly tokens: Token[];
  private readonly src: string;
  private pos = 0;
  readonly symbols: ScadSymbol[] = [];
  readonly callSites: CallSite[] = [];
  readonly diagnostics: ScadDiagnostic[] = [];

  constructor(tokens: Token[], src: string) {
    this.tokens = tokens;
    this.src = src;
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }

  private textBetween(start: ScadPosition, end: ScadPosition): string {
    const lines = this.src.split('\n');
    if (start.line === end.line) {
      return lines[start.line].slice(start.col, end.col);
    }
    const parts: string[] = [lines[start.line].slice(start.col)];
    for (let l = start.line + 1; l < end.line; l++) parts.push(lines[l]);
    parts.push(lines[end.line].slice(0, end.col));
    return parts.join('\n');
  }

  // Skips one balanced bracketed group starting at an open bracket token
  // (already positioned there). Returns the matching close token, or undefined
  // if the input ends first (mismatch already reported by scanBalanced caller
  // in that case via a synthetic close-consumption below).
  private skipBalanced(): Token | undefined {
    const open = this.next()!;
    const stack: Token[] = [open];
    while (!this.atEnd()) {
      const tok = this.peek()!;
      if (tok.type === 'bracket') {
        if (tok.text in OPEN_BRACKETS) {
          stack.push(tok);
          this.next();
          continue;
        }
        // closing bracket
        const top = stack[stack.length - 1];
        const wanted = OPEN_BRACKETS[top.text];
        if (tok.text === wanted) {
          stack.pop();
          this.next();
          if (stack.length === 0) return tok;
          continue;
        }
        // mismatched close: report and treat as closing the innermost open anyway
        this.diagnostics.push({
          severity: 'error',
          message: `Mismatched bracket: expected '${wanted}' but found '${tok.text}'`,
          range: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
        });
        stack.pop();
        this.next();
        if (stack.length === 0) return tok;
        continue;
      }
      this.next();
    }
    this.diagnostics.push({
      severity: 'error',
      message: `Unmatched '${open.text}'`,
      range: { startLine: open.start.line, startCol: open.start.col, endLine: open.end.line, endCol: open.end.col },
    });
    return undefined;
  }

  // Splits the tokens strictly between an already-consumed '(' and its
  // matching ')' (both positions given) into top-level comma-separated
  // parameter entries.
  private parseParamList(openIdx: number, closeIdx: number): ScadParam[] {
    const params: ScadParam[] = [];
    let i = openIdx + 1;
    let depth = 0;
    let nameToken: Token | null = null;
    let defaultStart: number | null = null;

    const flush = (endIdx: number) => {
      if (nameToken) {
        const defaultText =
          defaultStart !== null && defaultStart < endIdx
            ? this.textBetween(this.tokens[defaultStart].start, this.tokens[endIdx - 1].end).trim()
            : null;
        params.push({ name: nameToken.text, defaultText: defaultText || null });
      }
      nameToken = null;
      defaultStart = null;
    };

    while (i < closeIdx) {
      const tok = this.tokens[i];
      if (tok.type === 'bracket') {
        if (tok.text in OPEN_BRACKETS) depth++;
        else depth--;
      }
      if (depth === 0 && tok.type === 'punct' && tok.text === ',') {
        flush(i);
        i++;
        continue;
      }
      if (depth === 0 && nameToken === null && tok.type === 'ident') {
        nameToken = tok;
        i++;
        continue;
      }
      if (depth === 0 && nameToken && defaultStart === null && tok.type === 'op' && tok.text === '=') {
        defaultStart = i + 1;
        i++;
        continue;
      }
      i++;
    }
    flush(closeIdx);
    return params;
  }

  // Finds the index of the matching close bracket for the open bracket at
  // `openIdx`, without mutating parser position. Returns -1 if unmatched.
  private findMatchingClose(openIdx: number): number {
    const stack: string[] = [];
    for (let i = openIdx; i < this.tokens.length; i++) {
      const tok = this.tokens[i];
      if (tok.type !== 'bracket') continue;
      if (tok.text in OPEN_BRACKETS) {
        stack.push(tok.text);
      } else {
        const want = CLOSE_BRACKETS[tok.text];
        if (stack.length > 0 && stack[stack.length - 1] === want) {
          stack.pop();
          if (stack.length === 0) return i;
        } else if (stack.length === 0) {
          return -1;
        } else {
          stack.pop();
        }
      }
    }
    return -1;
  }

  private consumeParenGroup(): { openIdx: number; closeIdx: number } | null {
    const tok = this.peek();
    if (!tok || tok.type !== 'bracket' || tok.text !== '(') return null;
    const openIdx = this.pos;
    const closeIdx = this.findMatchingClose(openIdx);
    if (closeIdx === -1) {
      // Reuse skipBalanced's mismatch/unmatched diagnostics.
      this.skipBalanced();
      return null;
    }
    this.pos = closeIdx + 1;
    return { openIdx, closeIdx };
  }

  private skipToStatementEnd(): void {
    // Best-effort recovery: skip to the next top-level ';' or '{'/'}'.
    while (!this.atEnd()) {
      const tok = this.peek()!;
      if (tok.type === 'bracket') {
        if (tok.text in OPEN_BRACKETS) {
          this.skipBalanced();
          continue;
        }
        return;
      }
      if (tok.type === 'punct' && tok.text === ';') {
        this.next();
        return;
      }
      this.next();
    }
  }

  private parseModule(moduleKeyword: Token): void {
    const nameTok = this.peek();
    if (!nameTok || nameTok.type !== 'ident') {
      this.diagnostics.push({
        severity: 'error',
        message: "Expected a name after 'module'",
        range: {
          startLine: moduleKeyword.start.line,
          startCol: moduleKeyword.start.col,
          endLine: moduleKeyword.end.line,
          endCol: moduleKeyword.end.col,
        },
      });
      this.skipToStatementEnd();
      return;
    }
    this.next();

    const paren = this.consumeParenGroup();
    if (!paren) {
      this.diagnostics.push({
        severity: 'error',
        message: `Expected '(' after module name '${nameTok.text}'`,
        range: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
      });
      this.skipToStatementEnd();
      return;
    }
    const params = this.parseParamList(paren.openIdx, paren.closeIdx);

    this.symbols.push({
      kind: 'module',
      name: nameTok.text,
      nameRange: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
      params,
      valueText: null,
    });

    const bodyOpen = this.peek();
    if (bodyOpen && bodyOpen.type === 'bracket' && bodyOpen.text === '{') {
      this.parseBlockBody();
    } else if (bodyOpen && bodyOpen.type === 'punct' && bodyOpen.text === ';') {
      this.next(); // module declared with no body (forward-decl style / empty statement)
    } else {
      // Single-statement module body, e.g. `module foo() cube(1);`
      this.parseStatement();
    }
  }

  private parseFunction(functionKeyword: Token): void {
    const nameTok = this.peek();
    if (!nameTok || nameTok.type !== 'ident') {
      this.diagnostics.push({
        severity: 'error',
        message: "Expected a name after 'function'",
        range: {
          startLine: functionKeyword.start.line,
          startCol: functionKeyword.start.col,
          endLine: functionKeyword.end.line,
          endCol: functionKeyword.end.col,
        },
      });
      this.skipToStatementEnd();
      return;
    }
    this.next();

    const paren = this.consumeParenGroup();
    if (!paren) {
      this.diagnostics.push({
        severity: 'error',
        message: `Expected '(' after function name '${nameTok.text}'`,
        range: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
      });
      this.skipToStatementEnd();
      return;
    }
    const params = this.parseParamList(paren.openIdx, paren.closeIdx);

    const eq = this.peek();
    if (!eq || eq.type !== 'op' || eq.text !== '=') {
      this.diagnostics.push({
        severity: 'error',
        message: `Expected '=' in function definition '${nameTok.text}'`,
        range: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
      });
      this.symbols.push({
        kind: 'function',
        name: nameTok.text,
        nameRange: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
        params,
        valueText: null,
      });
      this.skipToStatementEnd();
      return;
    }
    this.next();

    const valueText = this.consumeExpressionValue(nameTok, `Unterminated function definition '${nameTok.text}'`);

    this.symbols.push({
      kind: 'function',
      name: nameTok.text,
      nameRange: { startLine: nameTok.start.line, startCol: nameTok.start.col, endLine: nameTok.end.line, endCol: nameTok.end.col },
      params,
      valueText,
    });
  }

  // Consumes an opaque expression up to a top-level ';' (consuming it),
  // returning the expression's raw text (or null if empty/missing), and
  // reporting `label` as unterminated (anchored at `ownerTok`) if input ends
  // first. Shared by function-body and assignment-value parsing.
  private consumeExpressionValue(ownerTok: Token, label: string): string | null {
    const bodyStartIdx = this.pos;
    const semiIdx = this.scanExpressionUntilSemicolon();
    if (semiIdx === -1) {
      this.diagnostics.push({
        severity: 'error',
        message: `${label} (missing ';')`,
        range: { startLine: ownerTok.start.line, startCol: ownerTok.start.col, endLine: ownerTok.end.line, endCol: ownerTok.end.col },
      });
      return null;
    }
    const valueText = semiIdx > bodyStartIdx ? this.textBetween(this.tokens[bodyStartIdx].start, this.tokens[semiIdx - 1].end).trim() : '';
    this.pos = semiIdx + 1;
    return valueText || null;
  }

  // Scans forward from current position, treating the expression as opaque
  // but bracket-aware, until a top-level ';' (returns its index) or end of
  // input (returns -1). Uses a bracket-kind stack (not just a depth counter)
  // so a mismatch like `[1, 2, 3)` is still caught even inside an otherwise
  // unparsed expression. Also records any call sites found along the way,
  // since expressions like `ternary ? foo(x) : bar(y)` still contain calls
  // we want in the flat symbol/call table.
  private scanExpressionUntilSemicolon(): number {
    const stack: Token[] = [];
    while (!this.atEnd()) {
      const tok = this.peek()!;
      if (tok.type === 'bracket') {
        if (tok.text in OPEN_BRACKETS) {
          stack.push(tok);
          this.next();
          continue;
        }
        if (stack.length === 0) {
          this.diagnostics.push({
            severity: 'error',
            message: `Unexpected closing bracket '${tok.text}'`,
            range: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
          });
          this.next();
          continue;
        }
        const top = stack[stack.length - 1];
        const wanted = OPEN_BRACKETS[top.text];
        if (tok.text !== wanted) {
          this.diagnostics.push({
            severity: 'error',
            message: `Mismatched bracket: expected '${wanted}' but found '${tok.text}'`,
            range: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
          });
        }
        stack.pop();
        this.next();
        continue;
      }
      if (stack.length === 0 && tok.type === 'punct' && tok.text === ';') {
        return this.pos;
      }
      if (
        tok.type === 'ident' &&
        !EXPRESSION_KEYWORDS.has(tok.text) &&
        this.peek(1)?.type === 'bracket' &&
        this.peek(1)?.text === '('
      ) {
        this.callSites.push({
          name: tok.text,
          nameRange: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
        });
      }
      this.next();
    }
    return -1;
  }

  // Parses `identifier(...)` call/instantiation statements (including
  // modifier chains like `color(...) translate(...) cube(...);`) and
  // `identifier = <expr>;` assignments. Also handles bare `identifier;`
  // (module instantiation with no args is rare but modifiers like `%cube();`
  // still resolve to a plain ident call token).
  private parseIdentStatement(): void {
    // Walk a chain of `name(...)` calls (each may itself be followed by a
    // child statement/block, or another call — modifier chaining), then
    // either an assignment or the terminal statement/block/`;`.
    for (;;) {
      const tok = this.peek();
      if (!tok || tok.type !== 'ident') break;
      if (STATEMENT_KEYWORDS.has(tok.text)) break;

      const after = this.peek(1);
      if (after && after.type === 'bracket' && after.text === '(') {
        this.callSites.push({
          name: tok.text,
          nameRange: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
        });
        this.next();
        this.consumeParenGroup();
        continue;
      }

      if (after && after.type === 'op' && after.text === '=') {
        this.next(); // ident
        this.next(); // '='
        const valueText = this.consumeExpressionValue(tok, `Unterminated assignment to '${tok.text}'`);
        this.symbols.push({
          kind: 'variable',
          name: tok.text,
          nameRange: { startLine: tok.start.line, startCol: tok.start.col, endLine: tok.end.line, endCol: tok.end.col },
          params: null,
          valueText,
        });
        return;
      }

      // Bare identifier used as a statement on its own (e.g. `children;`,
      // or the tail of a modifier chain with no call syntax) — not useful
      // structurally; just consume it.
      this.next();
      break;
    }

    const tail = this.peek();
    if (tail && tail.type === 'bracket' && tail.text === '{') {
      this.parseBlockBody();
    } else if (tail && tail.type === 'punct' && tail.text === ';') {
      this.next();
    } else if (tail && !(tail.type === 'bracket' && (tail.text === '}' || tail.text === ')' || tail.text === ']'))) {
      // Another statement follows directly (rest of a modifier chain), e.g.
      // `color("red") cube(1);` — recurse into parseStatement for the tail.
      this.parseStatement();
    }
  }

  private parseBlockBody(): void {
    const open = this.peek();
    if (!open || open.type !== 'bracket' || open.text !== '{') return;
    this.next();
    while (!this.atEnd()) {
      const tok = this.peek()!;
      if (tok.type === 'bracket' && tok.text === '}') {
        this.next();
        return;
      }
      this.parseStatement();
    }
    this.diagnostics.push({
      severity: 'error',
      message: "Unmatched '{'",
      range: { startLine: open.start.line, startCol: open.start.col, endLine: open.end.line, endCol: open.end.col },
    });
  }

  private parseStatement(): void {
    const tok = this.peek();
    if (!tok) return;

    if (tok.type === 'bracket' && tok.text === '{') {
      this.parseBlockBody();
      return;
    }

    if (tok.type === 'punct' && tok.text === ';') {
      this.next();
      return;
    }

    if (tok.type === 'ident' && tok.text === 'module') {
      this.next();
      this.parseModule(tok);
      return;
    }

    if (tok.type === 'ident' && tok.text === 'function') {
      this.next();
      this.parseFunction(tok);
      return;
    }

    if (tok.type === 'ident' && (tok.text === 'include' || tok.text === 'use')) {
      this.next();
      // `include <path>` / `use <path>` — angle-bracket path, not a comparison.
      const lt = this.peek();
      if (lt && lt.type === 'op' && lt.text === '<') {
        this.next();
        while (!this.atEnd()) {
          const c = this.peek()!;
          if (c.type === 'op' && c.text === '>') {
            this.next();
            break;
          }
          this.next();
        }
      } else {
        this.skipToStatementEnd();
      }
      return;
    }

    if (tok.type === 'ident' && (tok.text === 'if' || tok.text === 'for' || tok.text === 'intersection_for')) {
      this.next();
      this.consumeParenGroup();
      this.parseStatement();
      const elseTok = this.peek();
      if (elseTok && elseTok.type === 'ident' && elseTok.text === 'else') {
        this.next();
        this.parseStatement();
      }
      return;
    }

    if (tok.type === 'ident') {
      this.parseIdentStatement();
      return;
    }

    // Modifier characters (%, #, !, *) prefixing a statement, or any other
    // stray top-level token: skip it silently and keep going (no diagnostic
    // — unrecognized top-level tokens are intentionally not flagged).
    this.next();
  }

  parseProgram(): void {
    while (!this.atEnd()) {
      this.parseStatement();
    }
  }
}

function buildCallSitesResolution(
  symbolsByName: Map<string, ScadSymbol[]>,
  callSites: CallSite[],
  builtinNames: ReadonlySet<string>,
): ScadDiagnostic[] {
  const diagnostics: ScadDiagnostic[] = [];
  for (const call of callSites) {
    if (symbolsByName.has(call.name)) continue;
    if (builtinNames.has(call.name)) continue;
    diagnostics.push({
      severity: 'warning',
      message: `Unknown function or module '${call.name}'`,
      range: call.nameRange,
    });
  }
  return diagnostics;
}

export function tokenize(source: string): { tokens: Token[]; diagnostics: ScadDiagnostic[] } {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  return { tokens, diagnostics: lexer.diagnostics };
}

export function parseScad(source: string, builtinNames: ReadonlySet<string> = new Set()): ParseResult {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const parser = new Parser(tokens, source);
  parser.parseProgram();

  const symbolsByName = new Map<string, ScadSymbol[]>();
  for (const sym of parser.symbols) {
    const list = symbolsByName.get(sym.name);
    if (list) list.push(sym);
    else symbolsByName.set(sym.name, [sym]);
  }

  const callDiagnostics = buildCallSitesResolution(symbolsByName, parser.callSites, builtinNames);

  return {
    symbols: parser.symbols,
    symbolsByName,
    callSites: parser.callSites,
    diagnostics: [...lexDiagnostics, ...parser.diagnostics, ...callDiagnostics],
  };
}
