/**
 * Test helpers: mint real RS256-signed JWTs the way Cloudflare Access does, and
 * fake the two things the auth verifier reaches out to — the JWKS endpoint and
 * the admin_users table.
 *
 * The tokens are genuinely signed with a keypair generated in-process, so the
 * signature-verification path in src/lib/auth.ts runs for real; only the source
 * of the public key (a mocked fetch) is faked.
 */
import type { AdminUser } from '../src/lib/types';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

export interface TokenClaims {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  sub?: string;
}

export interface TestKeys {
  kid: string;
  teamDomain: string;
  aud: string;
  jwk: JsonWebKey & { kid: string; alg: string; use: string };
  mint(claims?: TokenClaims, opts?: { kid?: string; alg?: string }): Promise<string>;
}

let teamCounter = 0;

/**
 * Generates a signing keypair and returns a minter plus the public JWK.
 *
 * The team domain is unique per call because src/lib/auth.ts caches the JWKS
 * per team domain across the whole isolate (correct production behaviour — keys
 * rotate on the order of weeks). Reusing one domain across tests would serve an
 * earlier test's key to a later one; a fresh domain keeps each test isolated.
 */
export async function setupKeys(
  teamDomain = `test-team-${teamCounter++}.cloudflareaccess.com`,
  aud = 'test-audience-tag'
): Promise<TestKeys> {
  const kid = 'test-key-1';
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );

  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const jwk = { ...pub, kid, alg: 'RS256', use: 'sig' } as JsonWebKey & { kid: string; alg: string; use: string };

  const now = Math.floor(Date.now() / 1000);

  async function mint(claims: TokenClaims = {}, opts: { kid?: string; alg?: string } = {}): Promise<string> {
    const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? kid, typ: 'JWT' };
    const payload: TokenClaims = {
      aud,
      email: 'editorial@fcheck.in',
      iss: `https://${teamDomain}`,
      sub: 'user-1',
      iat: now,
      exp: now + 3600,
      ...claims,
    };
    const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      pair.privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${b64url(new Uint8Array(sig))}`;
  }

  return { kid, teamDomain, aud, jwk, mint };
}

/** Installs a global fetch that serves the given JWKS at the Access certs URL. */
export function mockJwks(jwk: JsonWebKey): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url.includes('/cdn-cgi/access/certs')) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** A D1 stand-in whose admin_users lookup returns a fixed row (or null). */
export function fakeDb(adminRow: AdminUser | null): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return adminRow;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

export function sampleAdmin(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'admin-001',
    name: 'fcheck.in Editorial',
    email: 'editorial@fcheck.in',
    role: 'super_admin',
    active: 1,
    last_login_at: null,
    created_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}
