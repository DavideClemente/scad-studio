import type { languages } from 'monaco-editor';

export const OPENSCAD_LANGUAGE_ID = 'openscad';

export const openscadLanguageConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};

const keywords = ['module', 'function', 'if', 'else', 'for', 'let', 'each', 'include', 'use', 'true', 'false', 'undef'];

const builtins = [
  'cube', 'sphere', 'cylinder', 'polyhedron', 'polygon', 'circle', 'square', 'offset',
  'translate', 'rotate', 'scale', 'mirror', 'multmatrix', 'resize', 'color',
  'union', 'difference', 'intersection', 'hull', 'minkowski',
  'linear_extrude', 'rotate_extrude', 'projection', 'surface', 'import', 'render',
  'children', 'echo', 'assert',
  'abs', 'sign', 'min', 'max', 'sqrt', 'pow', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'floor', 'ceil', 'round', 'len', 'str', 'chr', 'ord', 'concat', 'lookup', 'search',
  'is_undef', 'is_bool', 'is_num', 'is_string', 'is_list', 'is_function', 'norm', 'cross',
];

export const openscadMonarchLanguage: languages.IMonarchLanguage = {
  defaultToken: '',
  keywords,
  builtins,
  symbols: /[=><!~?:&|+\-*/^%]+/,
  tokenizer: {
    root: [
      [/\$[a-zA-Z_]\w*/, 'variable.predefined'],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@builtins': 'type.identifier',
            '@default': 'identifier',
          },
        },
      ],
      { include: '@whitespace' },
      [/[{}()[\]]/, '@brackets'],
      [/@symbols/, 'operator'],
      [/\d+\.\d+([eE][-+]?\d+)?/, 'number.float'],
      [/\d+/, 'number'],
      [/"([^"\\]|\\.)*"/, 'string'],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\*/, 'comment', '@comment'],
      [/\/\/.*$/, 'comment'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
};
