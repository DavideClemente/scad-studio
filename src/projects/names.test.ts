import { describe, expect, it } from 'vitest';
import { freeName, isNameTaken } from './names';

const existing = [
  { id: '1', name: 'Bracket' },
  { id: '2', name: 'Wall hook' },
];

describe('project names', () => {
  it('treats case and surrounding space as the same name', () => {
    expect(isNameTaken(existing, 'bracket')).toBe(true);
    expect(isNameTaken(existing, '  BRACKET  ')).toBe(true);
    expect(isNameTaken(existing, 'Brackets')).toBe(false);
  });

  it('does not count a project against itself, so a rename can keep its name', () => {
    expect(isNameTaken(existing, 'Bracket', '1')).toBe(false);
    expect(isNameTaken(existing, 'Bracket', '2')).toBe(true);
  });

  it('offers the plain name when nothing has it', () => {
    expect(freeName(existing, 'Spacer')).toBe('Spacer');
  });

  it('counts up until it finds one free', () => {
    expect(freeName(existing, 'Bracket')).toBe('Bracket 2');
    expect(freeName([...existing, { id: '3', name: 'Bracket 2' }], 'Bracket')).toBe('Bracket 3');
  });
});
