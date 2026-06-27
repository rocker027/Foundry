import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillDescription, tokenize, isCompoundMode } from './retriever.mjs';

describe('retriever', () => {
  it('parseSkillDescription extracts frontmatter description', () => {
    const content = `---
name: test-skill
description: Processes PDF files and fills forms
---

# Test
`;
    assert.equal(parseSkillDescription(content), 'Processes PDF files and fills forms');
  });

  it('isCompoundMode detects plan/review keywords', () => {
    assert.equal(isCompoundMode('create implementation plan'), true);
    assert.equal(isCompoundMode('fix typo'), false);
  });

  it('tokenize splits words', () => {
    const tokens = tokenize('android crash fixer');
    assert.ok(tokens.includes('android'));
    assert.ok(tokens.includes('fixer'));
  });
});
