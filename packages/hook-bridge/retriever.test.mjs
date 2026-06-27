import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillDescription, tokenize, isCompoundMode, retrieveSkills } from './retriever.mjs';
import { isLegacySkillSlug, isExcludedSkill } from './skill-filter.mjs';

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

  it('isLegacySkillSlug flags deprecated memory skills', () => {
    assert.equal(isLegacySkillSlug('skill-mnemo'), true);
    assert.equal(isExcludedSkill('analyze'), true);
    assert.equal(isExcludedSkill('android-crash-fixer'), false);
  });

  it('retrieveSkills skips _deprecated and legacy slugs', () => {
    const prev = process.env.FOUNDRY_SKILLS_ROOT;
    const tmp = join(tmpdir(), `foundry-retriever-${Date.now()}`);
    const deprecatedSkill = join(tmp, '_deprecated', '2026-06-27', 'skill-mnemo');
    mkdirSync(deprecatedSkill, { recursive: true });
    writeFileSync(join(deprecatedSkill, 'SKILL.md'), `---
name: skill-mnemo
description: legacy memory layer sqlite sqlite sqlite
---

# mnemo
`, 'utf8');
    mkdirSync(join(tmp, 'real-skill'), { recursive: true });
    writeFileSync(join(tmp, 'real-skill', 'SKILL.md'), `---
name: real-skill
description: real workflow sqlite helper
---

# Real
`, 'utf8');
    process.env.FOUNDRY_SKILLS_ROOT = tmp;

    const matches = retrieveSkills({ prompt: 'sqlite workflow', limit: 10 });
    process.env.FOUNDRY_SKILLS_ROOT = prev;
    rmSync(tmp, { recursive: true, force: true });

    assert.ok(!matches.some((m) => m.slug === 'skill-mnemo'));
    assert.ok(matches.some((m) => m.slug === 'real-skill'));
  });
});
