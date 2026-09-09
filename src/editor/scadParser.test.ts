import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseScad } from './scadParser';
import { SCAD_BUILTIN_NAMES } from './scadBuiltins';
import { EXAMPLES } from '../examples';

const errorsOf = (source: string) => parseScad(source, SCAD_BUILTIN_NAMES).diagnostics.filter((d) => d.severity === 'error');

describe('tokenizer edge cases', () => {
  it('flags an unterminated string literal', () => {
    const { diagnostics } = parseScad('x = "hello;\n');
    expect(diagnostics.some((d) => d.severity === 'error' && /string/i.test(d.message))).toBe(true);
  });

  it('flags an unterminated block comment', () => {
    const { diagnostics } = parseScad('/* comment never ends\nx = 1;');
    expect(diagnostics.some((d) => d.severity === 'error' && /comment/i.test(d.message))).toBe(true);
  });

  it('accepts a well-formed string with escapes', () => {
    const { diagnostics } = parseScad('x = "a \\"quoted\\" value";');
    expect(errorsOf('x = "a \\"quoted\\" value";')).toHaveLength(0);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});

describe('bracket mismatch recovery', () => {
  it('flags an unmatched opening bracket', () => {
    const { diagnostics } = parseScad('module foo() {\n  cube(1);\n');
    expect(diagnostics.some((d) => /Unmatched/.test(d.message))).toBe(true);
  });

  it('flags a mismatched bracket pair', () => {
    const { diagnostics } = parseScad('x = [1, 2, 3);');
    expect(diagnostics.some((d) => /Mismatched bracket/.test(d.message))).toBe(true);
  });

  it('still recovers and parses subsequent declarations after a mismatch', () => {
    const { symbolsByName } = parseScad('x = [1, 2, 3);\nmodule after_error() {}');
    expect(symbolsByName.has('after_error')).toBe(true);
  });
});

describe('malformed module/function headers', () => {
  it('flags a module with no name', () => {
    const { diagnostics } = parseScad('module () {}');
    expect(diagnostics.some((d) => /Expected a name after .module./.test(d.message))).toBe(true);
  });

  it('flags a function with no name', () => {
    const { diagnostics } = parseScad('function () = 1;');
    expect(diagnostics.some((d) => /Expected a name after .function./.test(d.message))).toBe(true);
  });

  it('flags a module missing its parameter list', () => {
    const { diagnostics } = parseScad('module foo {}');
    expect(diagnostics.some((d) => /Expected '\('/.test(d.message))).toBe(true);
  });

  it('does not flag an unrecognized stray top-level token', () => {
    const { diagnostics } = parseScad('%\nmodule foo() {}');
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});

describe('parameter and default extraction', () => {
  it('extracts parameter names and default values', () => {
    const { symbolsByName } = parseScad('module rounded_box(w, d, h, r = 4) { cube([w, d, h]); }');
    const sym = symbolsByName.get('rounded_box')![0];
    expect(sym.params).toEqual([
      { name: 'w', defaultText: null },
      { name: 'd', defaultText: null },
      { name: 'h', defaultText: null },
      { name: 'r', defaultText: '4' },
    ]);
  });

  it('keeps bracketed default values intact when splitting on top-level commas', () => {
    const { symbolsByName } = parseScad('function f(a, b = [1, 2, 3], c = foo(1, 2)) = a;');
    const sym = symbolsByName.get('f')![0];
    expect(sym.params).toEqual([
      { name: 'a', defaultText: null },
      { name: 'b', defaultText: '[1, 2, 3]' },
      { name: 'c', defaultText: 'foo(1, 2)' },
    ]);
  });
});

describe('multi-line function bodies', () => {
  it('parses a function definition spanning multiple lines', () => {
    const source = `function adv(str) = textmetrics(text = str, size = REF, font = font,
  spacing = letter_spacing);`;
    const { symbolsByName, diagnostics } = parseScad(source);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
    const sym = symbolsByName.get('adv')![0];
    expect(sym.valueText).toContain('textmetrics');
    expect(sym.valueText).toContain('spacing = letter_spacing');
  });
});

describe('recursive functions', () => {
  it('resolves a self-referencing function without a false "unknown" diagnostic', () => {
    const source = 'function tucked(n) = n <= 0 ? 0 : tucked(n - 1) + 1;';
    const { diagnostics, callSites } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(diagnostics.some((d) => /Unknown function or module 'tucked'/.test(d.message))).toBe(false);
    expect(callSites.some((c) => c.name === 'tucked')).toBe(true);
  });
});

describe('call-position-only unknown-call rule', () => {
  it('does not flag a bare undeclared variable reference', () => {
    const { diagnostics } = parseScad('x = some_undeclared_variable + 1;', SCAD_BUILTIN_NAMES);
    expect(diagnostics.some((d) => d.severity === 'warning')).toBe(false);
  });

  it('flags a call to an undeclared function/module', () => {
    const { diagnostics } = parseScad('totally_made_up_fn(1, 2);', SCAD_BUILTIN_NAMES);
    expect(diagnostics.some((d) => d.severity === 'warning' && /totally_made_up_fn/.test(d.message))).toBe(true);
  });

  it('does not flag calls to known builtins', () => {
    const { diagnostics } = parseScad('translate([1, 0, 0]) cube(1);', SCAD_BUILTIN_NAMES);
    expect(diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('does not flag common builtins used pervasively in real designs (children, len, floor, search)', () => {
    const source = 'module wrap() { children(); } x = floor(len(search("a", "abc")));';
    const { diagnostics } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('does not mistake an `if` following a modifier chain for a call', () => {
    const source = 'translate([1, 0, 0]) if (true) cube(1); else sphere(1);';
    const { diagnostics, callSites } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(callSites.some((c) => c.name === 'if')).toBe(false);
    expect(diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });
});

describe('opaque expression forms', () => {
  it('parses a list comprehension as one opaque declaration with no spurious diagnostics', () => {
    const source = 'squares = [for (i = [0 : 10]) i * i];';
    const { diagnostics, symbolsByName } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(diagnostics).toHaveLength(0);
    expect(symbolsByName.get('squares')![0].valueText).toContain('for');
  });

  it('does not mistake `for`/`let`/`if` inside a list comprehension for calls', () => {
    const source =
      'function metrics(k) = k; boxes = [for (k = [0 : len(name) - 1]) let (m = metrics(name[k])) if (m.size[0] > 0) m];';
    const { diagnostics, callSites } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(callSites.map((c) => c.name)).not.toEqual(expect.arrayContaining(['for', 'let', 'if']));
    expect(diagnostics.filter((d) => d.severity === 'warning')).toHaveLength(0);
  });

  it('parses a let() expression as one opaque declaration', () => {
    const source = 'result = let (a = 1, b = 2) a + b;';
    const { diagnostics, symbolsByName } = parseScad(source, SCAD_BUILTIN_NAMES);
    expect(diagnostics).toHaveLength(0);
    expect(symbolsByName.has('result')).toBe(true);
  });

  it('parses a ternary expression as one opaque declaration', () => {
    const source = 'is_upper = len(search("A", "ABC")) > 0 ? true : false;';
    expect(errorsOf(source)).toHaveLength(0);
  });
});

describe('real content smoke tests', () => {
  it('parses a verbatim snippet from designs/name-ornament.scad without spurious diagnostics', () => {
    const source = `function prefix(n) = n <= 0 ? "" : chr([for (i = [0 : n - 1]) ord(name[i])]);
function tucked(n) = n <= 0 ? 0 : tucked(n - 1) + REF * tuck_for(name[n - 1]);
function pen_ref(n) = n <= 0 ? 0 : adv(prefix(n + 1)) - adv(name[n]) - tucked(n);`;
    expect(errorsOf(source)).toHaveLength(0);
  });

  it('parses one EXAMPLES entry from src/examples.ts without spurious diagnostics', () => {
    expect(parseScad(EXAMPLES[0].source, SCAD_BUILTIN_NAMES).diagnostics).toHaveLength(0);
  });

  it('produces zero diagnostics for the full designs/name-ornament.scad file', () => {
    const path = fileURLToPath(new URL('../../designs/name-ornament.scad', import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(parseScad(source, SCAD_BUILTIN_NAMES).diagnostics).toHaveLength(0);
  });
});
