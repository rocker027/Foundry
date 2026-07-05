import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactString } from './redact.mjs';

describe('redactString', () => {
  it('redacts OpenAI API keys', () => {
    const input = 'token sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const out = redactString(input);
    assert.ok(!out.includes('abcdefghijklmnopqrstuvwxyz1234567890'));
    assert.ok(out.includes('sk-[REDACTED]'));
  });

  it('redacts GitHub tokens', () => {
    const input = 'ghp_abcdefghijklmnopqrst';
    const out = redactString(input);
    assert.ok(out.includes('ghp_[REDACTED]'));
    assert.ok(!out.includes('ghp_abcdefghijklmnopqrst'));
  });

  it('redacts AWS access keys', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE';
    const out = redactString(input);
    assert.ok(out.includes('AKIA[REDACTED]'));
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
    const out = redactString(input);
    assert.ok(out.includes('Bearer [REDACTED]'));
  });

  it('redacts api_key assignments', () => {
    const input = 'api_key=supersecretvalue12345';
    const out = redactString(input);
    assert.ok(out.includes('api_key=[REDACTED]'));
  });

  it('redacts Anthropic keys', () => {
    const input = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890';
    const out = redactString(input);
    assert.ok(out.includes('sk-ant-[REDACTED]'));
  });

  it('redacts github_pat tokens', () => {
    const input = 'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const out = redactString(input);
    assert.ok(out.includes('github_pat_[REDACTED]'));
  });

  it('redacts PEM private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    const out = redactString(input);
    assert.ok(out.includes('[REDACTED PEM]'));
  });

  it('passes through safe strings unchanged', () => {
    const input = 'npm test -- --coverage';
    assert.equal(redactString(input), input);
  });
});
