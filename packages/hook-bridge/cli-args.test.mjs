import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFixArgs, parseDeriveArgs, parseAuditArgs, parseDeprecateLegacyArgs,
} from './cli-args.mjs';

describe('CLI argument parsing', () => {
  describe('parseFixArgs', () => {
    it('parses slug and session id', () => {
      const result = parseFixArgs(['android-crash-fixer', '--from-session', 'abc-123']);
      assert.deepEqual(result, { slug: 'android-crash-fixer', sessionId: 'abc-123' });
    });

    it('returns null when session missing', () => {
      const result = parseFixArgs(['my-slug']);
      assert.equal(result.slug, 'my-slug');
      assert.equal(result.sessionId, null);
    });
  });

  describe('parseDeriveArgs', () => {
    it('parses parent slug, session, and variant', () => {
      const result = parseDeriveArgs([
        'android-crash-fixer', '--from-session', 'sess-1', '--variant', 'npe-main',
      ]);
      assert.deepEqual(result, {
        parentSlug: 'android-crash-fixer',
        sessionId: 'sess-1',
        variant: 'npe-main',
      });
    });

    it('returns null variant when omitted', () => {
      const result = parseDeriveArgs(['parent-skill', '--from-session', 'sess-2']);
      assert.equal(result.parentSlug, 'parent-skill');
      assert.equal(result.sessionId, 'sess-2');
      assert.equal(result.variant, null);
    });
  });

  describe('parseAuditArgs', () => {
    it('detects knowledge subcommand', () => {
      assert.deepEqual(parseAuditArgs(['knowledge']), { subcommand: 'knowledge', rest: [] });
    });

    it('returns null subcommand for security audit', () => {
      assert.deepEqual(parseAuditArgs([]), { subcommand: null, rest: [] });
    });
  });

  describe('parseDeprecateLegacyArgs', () => {
    it('defaults to dry-run', () => {
      assert.deepEqual(parseDeprecateLegacyArgs([]), { dryRun: true, execute: false });
    });

    it('sets execute when --execute passed', () => {
      assert.deepEqual(parseDeprecateLegacyArgs(['--execute']), { dryRun: false, execute: true });
    });
  });
});
