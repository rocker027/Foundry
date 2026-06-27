import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isExcludedSkill, isOmxPluginSkill, loadUserDenylist, getExcludedSlugList,
} from './skill-filter.mjs';

describe('skill-filter', () => {
  let tmp;
  let prevMemory;

  beforeEach(() => {
    tmp = join(tmpdir(), `foundry-filter-${Date.now()}`);
    mkdirSync(join(tmp, 'config'), { recursive: true });
    prevMemory = process.env.FOUNDRY_MEMORY_ROOT;
    process.env.FOUNDRY_MEMORY_ROOT = tmp;
  });

  afterEach(() => {
    if (prevMemory === undefined) delete process.env.FOUNDRY_MEMORY_ROOT;
    else process.env.FOUNDRY_MEMORY_ROOT = prevMemory;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('isOmxPluginSkill detects [OMX] descriptions', () => {
    assert.equal(isOmxPluginSkill('[OMX] Guide on plugin'), true);
    assert.equal(isOmxPluginSkill('Regular skill'), false);
  });

  it('isExcludedSkill covers legacy and plugin infra slugs', () => {
    assert.equal(isExcludedSkill('skill-mnemo'), true);
    assert.equal(isExcludedSkill('analyze'), true);
    assert.equal(isExcludedSkill('android-crash-fixer'), false);
  });

  it('loadUserDenylist reads config slugs', () => {
    writeFileSync(join(tmp, 'config', 'skill-denylist.json'), JSON.stringify({
      slugs: ['custom-skill'],
    }), 'utf8');
    assert.ok(loadUserDenylist({ refresh: true }).has('custom-skill'));
    assert.ok(getExcludedSlugList().includes('custom-skill'));
  });
});
