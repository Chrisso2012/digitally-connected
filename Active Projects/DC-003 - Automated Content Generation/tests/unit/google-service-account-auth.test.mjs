import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { fetchGoogleServiceAccountAccessToken, _internal } from "../../src/google-service-account-auth.mjs";
import { ContentSourceAuthenticationError, ContentSourceConfigurationError, ContentSourceTransportError } from "../../src/content-source-errors.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" });

function fakeFetchOk(accessToken = "fake-access-token") {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, expires_in: 3600 }),
  });
}

test("fetchGoogleServiceAccountAccessToken() signs a JWT and exchanges it for an access token", async () => {
  let capturedBody = null;
  const fetchImpl = async (url, init) => {
    capturedBody = init.body;
    return { ok: true, status: 200, json: async () => ({ access_token: "abc123", expires_in: 3600 }) };
  };

  const result = await fetchGoogleServiceAccountAccessToken(
    { clientEmail: "svc@example.iam.gserviceaccount.com", privateKey: PRIVATE_KEY_PEM, scopes: ["https://www.googleapis.com/auth/drive.readonly"] },
    { fetchImpl, now: () => 1_700_000_000_000 }
  );

  assert.equal(result.accessToken, "abc123");
  assert.equal(result.expiresInSeconds, 3600);

  const params = new URLSearchParams(capturedBody);
  assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = params.get("assertion");
  const [headerB64, payloadB64, signatureB64] = assertion.split(".");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  assert.equal(payload.iss, "svc@example.iam.gserviceaccount.com");
  assert.equal(payload.scope, "https://www.googleapis.com/auth/drive.readonly");

  // Verify the JWT signature is genuinely valid against the matching public key.
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  assert.ok(verifier.verify(publicKey, Buffer.from(signatureB64, "base64url")));
});

test("fetchGoogleServiceAccountAccessToken() throws ContentSourceConfigurationError for missing config", async () => {
  await assert.rejects(() => fetchGoogleServiceAccountAccessToken({}, { fetchImpl: fakeFetchOk() }), ContentSourceConfigurationError);
});

test("fetchGoogleServiceAccountAccessToken() throws ContentSourceAuthenticationError on HTTP 401/400", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  await assert.rejects(
    () =>
      fetchGoogleServiceAccountAccessToken(
        { clientEmail: "svc@example.com", privateKey: PRIVATE_KEY_PEM, scopes: ["scope"] },
        { fetchImpl, now: () => Date.now() }
      ),
    ContentSourceAuthenticationError
  );
});

test("fetchGoogleServiceAccountAccessToken() throws ContentSourceTransportError on other HTTP errors", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  await assert.rejects(
    () =>
      fetchGoogleServiceAccountAccessToken(
        { clientEmail: "svc@example.com", privateKey: PRIVATE_KEY_PEM, scopes: ["scope"] },
        { fetchImpl, now: () => Date.now() }
      ),
    ContentSourceTransportError
  );
});

test("fetchGoogleServiceAccountAccessToken() throws ContentSourceConfigurationError for a malformed private key", async () => {
  await assert.rejects(
    () =>
      fetchGoogleServiceAccountAccessToken(
        { clientEmail: "svc@example.com", privateKey: "not-a-real-pem-key", scopes: ["scope"] },
        { fetchImpl: fakeFetchOk(), now: () => Date.now() }
      ),
    ContentSourceConfigurationError
  );
});

test("_internal.base64url() produces URL-safe base64 with no padding", () => {
  const encoded = _internal.base64url(JSON.stringify({ a: 1 }));
  assert.doesNotMatch(encoded, /[+/=]/);
});
