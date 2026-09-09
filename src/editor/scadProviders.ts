// Monaco glue for the structural parser: completion/hover/definition
// providers plus a marker-conversion helper for diagnostics. This is the
// only file that imports monaco-editor value types alongside scadParser.ts
// and scadBuiltins.ts.
import type { Monaco } from '@monaco-editor/react';
import type { editor, languages, IRange } from 'monaco-editor';
import { OPENSCAD_LANGUAGE_ID } from './scadLanguage';
import { parseScad } from './scadParser';
import type { ParseResult, ScadRange, ScadSymbol } from './scadParser';
import { SCAD_BUILTINS_BY_NAME, SCAD_BUILTIN_NAMES } from './scadBuiltins';
import type { ScadBuiltin } from './scadBuiltins';

// Module-scoped memoized parse: there's exactly one document in this app, so
// every provider callback and the diagnostics pass share one parseScad call
// per actual content change instead of one per callback.
let lastSource: string | null = null;
let lastResult: ParseResult | null = null;

function getParseResult(source: string): ParseResult {
  if (lastSource === source && lastResult) return lastResult;
  lastResult = parseScad(source, SCAD_BUILTIN_NAMES);
  lastSource = source;
  return lastResult;
}

function toMonacoRange(range: ScadRange): IRange {
  return {
    startLineNumber: range.startLine + 1,
    startColumn: range.startCol + 1,
    endLineNumber: range.endLine + 1,
    endColumn: range.endCol + 1,
  };
}

export function getDiagnosticMarkers(monaco: Monaco, source: string): editor.IMarkerData[] {
  const { diagnostics } = getParseResult(source);
  return diagnostics.map((d) => ({
    severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: d.message,
    ...toMonacoRange(d.range),
  }));
}

function lastDeclaration(symbols: ScadSymbol[]): ScadSymbol {
  return symbols[symbols.length - 1];
}

function signatureOf(sym: ScadSymbol): string {
  const params = sym.params ?? [];
  const paramText = params.map((p) => (p.defaultText ? `${p.name} = ${p.defaultText}` : p.name)).join(', ');
  if (sym.kind === 'module') return `module ${sym.name}(${paramText})`;
  if (sym.kind === 'function') return `function ${sym.name}(${paramText}) = ${sym.valueText ?? '...'}`;
  return `${sym.name} = ${sym.valueText ?? 'undef'}`;
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function builtinHoverText(builtin: ScadBuiltin): string {
  return `${builtin.signature}\n\n${builtin.doc}`;
}

function symbolCompletionKind(monaco: Monaco, sym: ScadSymbol): languages.CompletionItemKind {
  if (sym.kind === 'module') return monaco.languages.CompletionItemKind.Module;
  if (sym.kind === 'function') return monaco.languages.CompletionItemKind.Function;
  return monaco.languages.CompletionItemKind.Variable;
}

export function createCompletionProvider(monaco: Monaco): languages.CompletionItemProvider {
  return {
    provideCompletionItems(model, position) {
      const source = model.getValue();
      const { symbolsByName } = getParseResult(source);
      const word = model.getWordUntilPosition(position);
      const range: IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions: languages.CompletionItem[] = [];

      for (const [name, symbols] of symbolsByName) {
        const sym = lastDeclaration(symbols);
        suggestions.push({
          label: name,
          kind: symbolCompletionKind(monaco, sym),
          insertText: name,
          detail: truncate(signatureOf(sym)),
          range,
        });
      }
      for (const [name, builtin] of SCAD_BUILTINS_BY_NAME) {
        suggestions.push({
          label: name,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: name,
          detail: builtin.signature,
          documentation: builtin.doc,
          range,
        });
      }

      return { suggestions };
    },
  };
}

export function createHoverProvider(): languages.HoverProvider {
  return {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const source = model.getValue();
      const { symbolsByName } = getParseResult(source);

      const userSymbols = symbolsByName.get(word.word);
      if (userSymbols) {
        const sym = lastDeclaration(userSymbols);
        return {
          contents: [{ value: `\`\`\`openscad\n${signatureOf(sym)}\n\`\`\`` }],
        };
      }

      const builtin = SCAD_BUILTINS_BY_NAME.get(word.word);
      if (builtin) {
        return { contents: [{ value: builtinHoverText(builtin) }] };
      }

      return null;
    },
  };
}

export function createDefinitionProvider(): languages.DefinitionProvider {
  return {
    provideDefinition(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const source = model.getValue();
      const { symbolsByName } = getParseResult(source);
      const symbols = symbolsByName.get(word.word);
      if (!symbols) return null;

      return symbols.map((sym) => ({
        uri: model.uri,
        range: toMonacoRange(sym.nameRange),
      }));
    },
  };
}

let registered = false;

export function registerScadProviders(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider(OPENSCAD_LANGUAGE_ID, createCompletionProvider(monaco));
  monaco.languages.registerHoverProvider(OPENSCAD_LANGUAGE_ID, createHoverProvider());
  monaco.languages.registerDefinitionProvider(OPENSCAD_LANGUAGE_ID, createDefinitionProvider());
}
