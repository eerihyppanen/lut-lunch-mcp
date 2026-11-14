import { describe, expect, it } from 'vitest';
import { smokeProblems } from '../../scripts/smoke-remote.js';

const TOOLS = ['find_dishes', 'get_menu', 'list_restaurants', 'menu_stats'];
const server = (version: string) => ({ name: 'lut-lunch-mcp', version });

describe('smokeProblems', () => {
  it('passes the expected version with all tools and a menu', () => {
    expect(
      smokeProblems({ server: server('0.3.2'), tools: TOOLS, menuError: null }, '0.3.2'),
    ).toEqual([]);
  });

  it('fails on another version, so a deploy waits for the new one', () => {
    expect(
      smokeProblems({ server: server('0.3.1'), tools: TOOLS, menuError: null }, '0.3.2'),
    ).toEqual(['server runs 0.3.1, expected 0.3.2']);
  });

  it('fails when get_menu fails on the right version (review focus)', () => {
    expect(
      smokeProblems({ server: server('0.3.2'), tools: TOOLS, menuError: 'boom' }, '0.3.2'),
    ).toEqual(['get_menu failed: boom']);
  });

  it('names the tools when one is missing', () => {
    const problems = smokeProblems(
      { server: server('0.3.2'), tools: TOOLS.slice(0, 3), menuError: null },
      '0.3.2',
    );
    expect(problems).toEqual(['tools are find_dishes, get_menu, list_restaurants']);
  });
});
