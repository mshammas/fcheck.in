/**
 * Verifies the Cloudflare Access token path in src/lib/auth.ts.
 *
 * This is the security boundary for the whole admin surface, and it is the part
 * that "needs a real Access app" mainly in order to be exercised. These tests
 * exercise it with genuinely-signed tokens, so the only thing left for a real
 * Access application is integration wiring, not the verification logic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { requireAdmin, AuthError, canPublish } from '../src/lib/auth';
import { setupKeys, mockJwks, fakeDb, sampleAdmin, type TestKeys } from './helpers';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function envFor(keys: TestKeys, over: Record<string, string | undefined> = {}) {
  return {
    CF_ACCESS_TEAM_DOMAIN: keys.teamDomain,
    CF_ACCESS_AUD: keys.aud,
    ENVIRONMENT: 'production',
    ...over,
  };
}

function reqWith(token: string): Request {
  return new Request('https://fcheck.in/admin', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
}

describe('requireAdmin — valid tokens', () => {
  it('accepts a genuine token from an active admin', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint({ email: 'editorial@fcheck.in' });

    const identity = await requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys));
    expect(identity.email).toBe('editorial@fcheck.in');
    expect(identity.user.role).toBe('super_admin');
  });

  it('reads the token from the CF_Authorization cookie too', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint();
    const req = new Request('https://fcheck.in/admin', {
      headers: { cookie: `CF_Authorization=${token}; other=x` },
    });

    const identity = await requireAdmin(req, fakeDb(sampleAdmin()), envFor(keys));
    expect(identity.email).toBe('editorial@fcheck.in');
  });
});

describe('requireAdmin — rejected tokens', () => {
  it('rejects an expired token', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const past = Math.floor(Date.now() / 1000) - 100;
    const token = await keys.mint({ exp: past, iat: past - 3600 });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/expired/i);
  });

  it('rejects a not-yet-valid token', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const future = Math.floor(Date.now() / 1000) + 3600;
    const token = await keys.mint({ iat: future, exp: future + 3600 });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/not yet valid/i);
  });

  it('rejects a token minted for a different audience', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint({ aud: 'some-other-app' });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/different application/i);
  });

  it('rejects a token from a different team (issuer mismatch)', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint({ iss: 'https://evil-team.cloudflareaccess.com' });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/different team/i);
  });

  it('rejects a tampered signature', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint();
    // Alter a mid-string signature char. Every base64url char except those in
    // the final (partial) group contributes a full 6 bits, so a mid-string
    // change always alters the decoded bytes — flipping the *last* char can be
    // a no-op, since its low bits are discarded when the final group is short.
    const parts = token.split('.');
    const sig = parts[2]!;
    const i = 5;
    parts[2] = sig.slice(0, i) + (sig[i] === 'A' ? 'B' : 'A') + sig.slice(i + 1);
    const tampered = parts.join('.');

    await expect(requireAdmin(reqWith(tampered), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/signature is invalid/i);
  });

  it('rejects a token signed by an unknown key', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk); // JWKS advertises kid "test-key-1"
    const token = await keys.mint({}, { kid: 'some-unknown-kid' });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/unknown key/i);
  });

  it('rejects a non-RS256 algorithm', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint({}, { alg: 'HS256' });

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(/algorithm/i);
  });
});

describe('requireAdmin — authorisation after a valid token', () => {
  it('rejects a verified email that is not an admin (403)', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint({ email: 'stranger@example.com' });

    await expect(requireAdmin(reqWith(token), fakeDb(null), envFor(keys)))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects an admin whose access was revoked (403)', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint();

    await expect(
      requireAdmin(reqWith(token), fakeDb(sampleAdmin({ active: 0 })), envFor(keys))
    ).rejects.toThrow(/revoked/i);
  });
});

describe('requireAdmin — configuration failures fail closed', () => {
  it('rejects a token when Access is not configured (no team domain)', async () => {
    const keys = await setupKeys();
    restore = mockJwks(keys.jwk);
    const token = await keys.mint();
    const env = { ENVIRONMENT: 'production' }; // no CF_ACCESS_* at all

    await expect(requireAdmin(reqWith(token), fakeDb(sampleAdmin()), env))
      .rejects.toMatchObject({ status: 403 });
  });

  it('rejects a request with no token in production', async () => {
    const keys = await setupKeys();
    const req = new Request('https://fcheck.in/admin');
    await expect(requireAdmin(req, fakeDb(sampleAdmin()), envFor(keys))).rejects.toThrow(AuthError);
  });
});

describe('dev bypass is gated on ENVIRONMENT', () => {
  it('accepts ADMIN_DEV_EMAIL only when ENVIRONMENT is development', async () => {
    const keys = await setupKeys();
    const req = new Request('https://fcheck.in/admin'); // no token
    const env = { ...envFor(keys), ENVIRONMENT: 'development', ADMIN_DEV_EMAIL: 'editorial@fcheck.in' };

    const identity = await requireAdmin(req, fakeDb(sampleAdmin()), env);
    expect(identity.email).toBe('editorial@fcheck.in');
  });

  it('ignores ADMIN_DEV_EMAIL outside development', async () => {
    const keys = await setupKeys();
    const req = new Request('https://fcheck.in/admin'); // no token
    const env = { ...envFor(keys), ENVIRONMENT: 'staging', ADMIN_DEV_EMAIL: 'editorial@fcheck.in' };

    await expect(requireAdmin(req, fakeDb(sampleAdmin()), env)).rejects.toThrow(AuthError);
  });

  it('requires ADMIN_DEV_EMAIL to be set even in development', async () => {
    const keys = await setupKeys();
    const req = new Request('https://fcheck.in/admin');
    const env = { ...envFor(keys), ENVIRONMENT: 'development' }; // no ADMIN_DEV_EMAIL

    await expect(requireAdmin(req, fakeDb(sampleAdmin()), env)).rejects.toThrow(AuthError);
  });
});

describe('canPublish', () => {
  it('lets super_admin and editor publish, but not reviewer', () => {
    expect(canPublish(sampleAdmin({ role: 'super_admin' }))).toBe(true);
    expect(canPublish(sampleAdmin({ role: 'editor' }))).toBe(true);
    expect(canPublish(sampleAdmin({ role: 'reviewer' }))).toBe(false);
  });
});
