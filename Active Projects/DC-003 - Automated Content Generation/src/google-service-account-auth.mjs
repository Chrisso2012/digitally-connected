// DC-003-I030 — Google Service Account authentication: the JWT Bearer
// token flow (RFC 7523 / Google's own documented service-account flow,
// https://developers.google.com/identity/protocols/oauth2/service-account#jwt-auth)
// used to obtain a short-lived OAuth2 access token without any interactive
// login. Uses Node's built-in `node:crypto` (RS256 JWT signing) and global
// `fetch` (Node 18+) only — no new dependency, mirroring
// llm-transport-http.mjs / renderer-transport-http.mjs's own "native
// fetch, no client SDK" convention. Generic across any Google API scope,
// not Docs/Drive-specific, so a future Google integration can reuse this
// file unchanged.
//
// Deliberately NOT the interactive OAuth2 user-consent flow (authorization
// code + browser redirect) — this codebase's own binding constraint is
// that no browser login or credential entry is ever performed by an
// agent (see DC-005-OC-001's own README for the same boundary applied to
// n8n). A service account is fully non-interactive: the operator
// provisions it once in Google Cloud, shares the target document with its
// email address (view access), and every subsequent authentication is a
// signed JWT exchange — no consent screen, no stored user session.

import { createSign } from "node:crypto";
import { ContentSourceAuthenticationError, ContentSourceTransportError, ContentSourceConfigurationError } from "./content-source-errors.mjs";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const JWT_LIFETIME_SECONDS = 3600;

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt({ clientEmail, privateKey, scopes }, now) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const issuedAt = Math.floor(now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: clientEmail,
      scope: scopes.join(" "),
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + JWT_LIFETIME_SECONDS,
    })
  );
  const unsigned = `${header}.${payload}`;

  let signature;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  } catch (cause) {
    throw new ContentSourceConfigurationError(`Google service account private_key could not be used to sign a JWT: ${cause.message}`);
  }
  return `${unsigned}.${base64url(signature)}`;
}

/**
 * config.clientEmail — the service account's own email (client_email in
 *   the downloaded key JSON).
 * config.privateKey — the service account's PEM private key (private_key
 *   in the downloaded key JSON, newlines intact).
 * config.scopes — array of OAuth2 scope URLs.
 * options.now — override the clock (used by tests).
 * options.fetchImpl — override fetch (used by tests; defaults to global fetch).
 *
 * Returns { accessToken, expiresInSeconds }. Never logs, returns, or
 * otherwise exposes the private key or the signed JWT itself.
 */
export async function fetchGoogleServiceAccountAccessToken(config, options = {}) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!config?.clientEmail || !config?.privateKey || !Array.isArray(config?.scopes) || config.scopes.length === 0) {
    throw new ContentSourceConfigurationError(
      "fetchGoogleServiceAccountAccessToken requires config.clientEmail, config.privateKey, and a non-empty config.scopes array"
    );
  }

  const assertion = signJwt(config, now);

  let response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: GRANT_TYPE, assertion }).toString(),
    });
  } catch (cause) {
    throw new ContentSourceTransportError(`Google token endpoint request failed: ${cause.message}`, cause);
  }

  if (response.status === 400 || response.status === 401) {
    throw new ContentSourceAuthenticationError(`Google rejected the service account JWT (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new ContentSourceTransportError(`Google token endpoint returned HTTP ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ContentSourceTransportError(`Google token endpoint response was not valid JSON: ${cause.message}`, cause);
  }
  if (typeof body.access_token !== "string" || body.access_token.trim() === "") {
    throw new ContentSourceTransportError("Google token endpoint response did not include an access_token");
  }

  return { accessToken: body.access_token, expiresInSeconds: body.expires_in ?? JWT_LIFETIME_SECONDS };
}

// Exported for tests only (deterministic JWT construction verification
// without a real private key round-trip) — never used by the adapter
// itself, which always goes through fetchGoogleServiceAccountAccessToken().
export const _internal = { base64url, signJwt };
