/**
 * Admin authentication via Cloudflare Access.
 *
 * Access sits in front of /admin/* and /api/admin/* as a zero-trust proxy: a
 * request only reaches this Worker after the user has signed in with the
 * identity provider configured in the Cloudflare dashboard. Access then
 * attaches a signed JWT in `Cf-Access-Jwt-Assertion`.
 *
 * We do not trust that header blindly. Anyone can send it, so we verify the
 * RS256 signature against the team's published JWKS and check the audience tag
 * before believing the email inside. Access being in front is defence in depth;
 * this verification is the actual gate.
 *
 * Being signed in is not the same as being an admin — the verified email must
 * also match an active row in admin_users.
 */
import type { AdminUser } from './types';

const JWKS_TTL_MS = 60 * 60 * 1000; // Cloudflare rotates keys ~every 6 weeks.

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  use?: string;
  n: string;
  e: string;
}

interface AccessClaims {
  aud: string | string[];
  email?: string;
  exp: number;
  iat: number;
  iss: string;
  sub: string;
}

/** Cached per isolate — a JWKS fetch on every admin request would be absurd. */
let jwksCache: { keys: Jwk[]; fetchedAt: number; teamDomain: string } | null = null;

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AdminIdentity {
  email: string;
  user: AdminUser;
}

/**
 * Verifies the Access JWT and resolves it to an active admin.
 *
 * Throws AuthError rather than returning null so that no caller can forget to
 * check — an unhandled throw fails closed.
 */
export async function requireAdmin(
  request: Request,
  db: D1Database,
  env: {
    CF_ACCESS_TEAM_DOMAIN?: string;
    CF_ACCESS_AUD?: string;
    ENVIRONMENT?: string;
    ADMIN_DEV_EMAIL?: string;
  }
): Promise<AdminIdentity> {
  const email = await resolveEmail(request, env);

  const user = await db
    .prepare('SELECT * FROM admin_users WHERE lower(email) = lower(?)')
    .bind(email)
    .first<AdminUser>();

  if (!user) {
    throw new AuthError(`${email} is not an fcheck.in admin.`, 403);
  }
  if (user.active !== 1) {
    throw new AuthError(`Admin access for ${email} has been revoked.`, 403);
  }

  return { email, user };
}

async function resolveEmail(
  request: Request,
  env: { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; ENVIRONMENT?: string; ADMIN_DEV_EMAIL?: string }
): Promise<string> {
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ?? readCookie(request, 'CF_Authorization');

  // Local development has no Access proxy in front of it. This bypass is gated
  // on ENVIRONMENT being exactly 'development' — a value that comes from
  // wrangler.jsonc, not from the request — so it cannot be reached in staging
  // or production even if ADMIN_DEV_EMAIL were somehow set there.
  if (!token) {
    if (env.ENVIRONMENT === 'development' && env.ADMIN_DEV_EMAIL) {
      return env.ADMIN_DEV_EMAIL;
    }
    throw new AuthError('No Cloudflare Access token on this request.');
  }

  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    // Failing closed here is deliberate. A misconfigured deployment must not
    // silently accept unverified tokens.
    throw new AuthError(
      'Cloudflare Access is not configured — set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.',
      403
    );
  }

  const claims = await verifyAccessJwt(token, env.CF_ACCESS_TEAM_DOMAIN, env.CF_ACCESS_AUD);
  if (!claims.email) throw new AuthError('Access token carries no email claim.');
  return claims.email;
}

async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  expectedAud: string
): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed Access token.');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
  const header = JSON.parse(decodeBase64Url(headerB64)) as { alg: string; kid: string };

  if (header.alg !== 'RS256') {
    throw new AuthError(`Unexpected token algorithm ${header.alg}.`);
  }

  const jwk = await findKey(teamDomain, header.kid);
  if (!jwk) throw new AuthError('Access token signed by an unknown key.');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );

  if (!valid) throw new AuthError('Access token signature is invalid.');

  const claims = JSON.parse(decodeBase64Url(payloadB64)) as AccessClaims;
  const now = Math.floor(Date.now() / 1000);

  if (claims.exp <= now) throw new AuthError('Access token has expired.');
  if (claims.iat > now + 60) throw new AuthError('Access token is not yet valid.');

  // The audience tag binds the token to *this* Access application. Without this
  // check, a token minted for any other app on the same team would be accepted.
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expectedAud)) {
    throw new AuthError('Access token was issued for a different application.');
  }

  const expectedIssuer = `https://${teamDomain}`;
  if (claims.iss !== expectedIssuer) {
    throw new AuthError('Access token was issued by a different team.');
  }

  return claims;
}

async function findKey(teamDomain: string, kid: string): Promise<Jwk | null> {
  const fresh =
    jwksCache && jwksCache.teamDomain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;

  if (fresh) {
    const hit = jwksCache!.keys.find((k) => k.kid === kid);
    if (hit) return hit;
    // Unknown kid against a warm cache usually means a rotation — refetch once.
  }

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new AuthError('Could not fetch Cloudflare Access signing keys.', 403);

  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys, fetchedAt: Date.now(), teamDomain };

  return keys.find((k) => k.kid === kid) ?? null;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function decodeBase64Url(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Roles that may publish or reject. Reviewers can open drafts but not ship. */
export function canPublish(user: AdminUser): boolean {
  return user.role === 'super_admin' || user.role === 'editor';
}
