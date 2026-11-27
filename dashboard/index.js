'use strict';

const crypto = require('node:crypto');
const https = require('node:https');
const REGIONS = ['us-east-1', 'us-west-2'];
const ISSUER_PARAMETER = '/cognito/issuer';
const CREDENTIAL_PARAMETERS = ['/cognito/encrypt', '/cognito/secret'];
const clientCache = new Map();

function awsClients(region) {
  if (!clientCache.has(region)) {
    const { SSMClient, DescribeParametersCommand, GetParameterCommand, GetParametersCommand } =
      require('@aws-sdk/client-ssm');
    const { SecretsManagerClient, GetSecretValueCommand } =
      require('@aws-sdk/client-secrets-manager');
    clientCache.set(region, {
      ssm: new SSMClient({ region }),
      secrets: new SecretsManagerClient({ region }),
      DescribeParametersCommand,
      GetParameterCommand,
      GetParametersCommand,
      GetSecretValueCommand,
    });
  }
  return clientCache.get(region);
}

async function sharedParameterArns(clients, names, region) {
  const arns = {};
  let nextToken;
  do {
    const result = await clients.ssm.send(new clients.DescribeParametersCommand({
      Shared: true,
      ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: names }],
      ...(nextToken ? { NextToken: nextToken } : {}),
    }));
    for (const parameter of result.Parameters || []) {
      if (!names.includes(parameter.Name) || !parameter.ARN) continue;
      if (arns[parameter.Name] && arns[parameter.Name] !== parameter.ARN) {
        throw new Error(`Multiple shared Cognito parameters named ${parameter.Name} in ${region}`);
      }
      arns[parameter.Name] = parameter.ARN;
    }
    nextToken = result.NextToken;
  } while (nextToken);
  if (names.some(name => !arns[name])) {
    throw new Error(`Missing shared Cognito parameters in ${region}`);
  }
  return arns;
}

async function loadIssuerForRegion(region, clients = awsClients(region)) {
  const arns = await sharedParameterArns(clients, [ISSUER_PARAMETER], region);
  const result = await clients.ssm.send(new clients.GetParameterCommand({
    Name: arns[ISSUER_PARAMETER],
  }));
  const issuer = result.Parameter?.Value;
  if (!/^https:\/\/issuer-cognito-idp\.us-east-1\.amazonaws\.com\/us-east-1_[A-Za-z0-9]+$/.test(issuer || '')) {
    throw new Error(`Invalid Cognito issuer in ${region}`);
  }
  return issuer;
}

async function loadCredentialsForRegion(region) {
  const clients = awsClients(region);
  const parameterArns = await sharedParameterArns(clients, CREDENTIAL_PARAMETERS, region);
  const [encryptArn, secretArn] = CREDENTIAL_PARAMETERS.map(name => parameterArns[name]);
  const parametersResult = await clients.ssm.send(new clients.GetParametersCommand({
    Names: [encryptArn, secretArn],
  }));
  const parameterValues = new Map();
  for (const parameter of parametersResult.Parameters || []) {
    parameterValues.set(parameter.ARN, parameter.Value);
    parameterValues.set(parameter.Name, parameter.Value);
  }
  const keyArn = parameterValues.get(encryptArn);
  const regionalSecretArn = parameterValues.get(secretArn);
  if (!new RegExp(`^arn:aws:kms:${region}:\\d{12}:key/[A-Za-z0-9-]+$`).test(keyArn || '') ||
      !new RegExp(`^arn:aws:secretsmanager:${region}:\\d{12}:secret:credentials-[A-Za-z0-9/_+=.@-]+$`).test(regionalSecretArn || '')) {
    throw new Error(`Invalid Cognito credential ARNs in ${region}`);
  }
  const secretResult = await clients.secrets.send(new clients.GetSecretValueCommand({
    SecretId: regionalSecretArn,
  }));
  const credentials = JSON.parse(secretResult.SecretString || '{}').Dashboard;
  if (!/^[a-z0-9]+$/.test(credentials?.CLIENT_ID || '') || !credentials.CLIENT_SECRET) {
    throw new Error(`Invalid dashboard credentials in ${region}`);
  }
  return { clientId: credentials.CLIENT_ID, clientSecret: credentials.CLIENT_SECRET };
}

async function loadJwks(issuer, kid, http) {
  const match = issuer.match(/^https:\/\/issuer-cognito-idp\.us-east-1\.amazonaws\.com\/(us-east-1_[A-Za-z0-9]+)$/);
  if (!match) throw new Error('Invalid Cognito issuer for JWKS lookup');
  let lastKeys;
  for (const region of REGIONS) {
    try {
      const response = await http(
        `https://issuer-cognito-idp.${region}.amazonaws.com/${match[1]}/.well-known/jwks.json`
      );
      if (response.status !== 200 || !Array.isArray(response.body.keys)) {
        throw new Error('Invalid JWKS response');
      }
      lastKeys = response.body.keys;
      if (lastKeys.some(key => key.kid === kid)) return lastKeys;
      console.warn(`Cognito JWKS does not include signing key in ${region}`);
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'Error';
      console.warn(`Cognito JWKS lookup failed in ${region}: ${errorName}`);
    }
  }
  if (lastKeys) return lastKeys;
  throw new Error('Unable to retrieve Cognito keys from any Region');
}

function createConfigurationLoader({ loadIssuer, loadCredentials, regions = REGIONS }) {
  async function loadWithFailover(resource, loader) {
    const failures = [];
    for (const region of regions) {
      try {
        return await loader(region);
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'Error';
        console.warn(`${resource} lookup failed in ${region}: ${errorName}`);
        failures.push(error);
      }
    }
    throw new AggregateError(failures, `Unable to load ${resource} in any configured Region`);
  }

  return async () => {
    const [issuer, credentials] = await Promise.all([
      loadWithFailover('Cognito issuer', loadIssuer),
      loadWithFailover('Cognito credentials', loadCredentials),
    ]);
    return { issuer, ...credentials };
  };
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { ...options, timeout: 5000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) request.destroy(new Error('Response too large'));
      });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: body ? JSON.parse(body) : null });
        } catch {
          reject(new Error('Invalid JSON response from Cognito'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

class InvalidToken extends Error {}

function createHandler({ configuration, http, now = () => Date.now() }) {
  let configCache;
  let jwksCache;

  async function config() {
    if (!configCache || configCache.until <= now()) {
      configCache = { value: await configuration(), until: now() + 300000 };
    }
    return configCache.value;
  }

  async function verify(token, settings, nonce) {
    let header, claims, parts;
    try {
      parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      header = JSON.parse(Buffer.from(parts[0], 'base64url'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Invalid JWT header');
    } catch {
      throw new InvalidToken('Malformed token');
    }
    if (!jwksCache || jwksCache.issuer !== settings.issuer || jwksCache.until <= now() ||
        !jwksCache.keys.some(key => key.kid === header.kid)) {
      jwksCache = {
        issuer: settings.issuer,
        keys: await loadJwks(settings.issuer, header.kid, http),
        until: now() + 3600000,
      };
    }
    const jwk = jwksCache.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
    if (!jwk) throw new InvalidToken('Unknown signing key');
    let valid;
    try {
      valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
        crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
    } catch {
      throw new InvalidToken('Invalid signature');
    }
    if (!valid || claims.iss !== settings.issuer || claims.aud !== settings.clientId ||
        claims.token_use !== 'id' || typeof claims.exp !== 'number' ||
        typeof claims.iat !== 'number' || claims.iat > now() / 1000 + 60 ||
        (nonce !== undefined && claims.nonce !== nonce)) {
      throw new InvalidToken('Invalid token claims');
    }
    return claims;
  }

  function seal(value, secret, host) {
    const key = crypto.createHash('sha256').update('4n6ir dashboard cookies:').update(secret).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(host));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
  }

  function unseal(value, secret, host) {
    try {
      const bytes = Buffer.from(value, 'base64url');
      const key = crypto.createHash('sha256').update('4n6ir dashboard cookies:').update(secret).digest();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(host));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
    } catch {
      return null;
    }
  }

  function cookie(name, value, maxAge) {
    const result = `__Host-${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
    if (result.length > 4000) throw new Error('Dashboard session cookie exceeds browser limit');
    return result;
  }

  function response(status, body, location, cookies = []) {
    const headers = {
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
      'x-content-type-options': [{ key: 'X-Content-Type-Options', value: 'nosniff' }],
      'referrer-policy': [{ key: 'Referrer-Policy', value: 'same-origin' }],
      'content-security-policy': [{ key: 'Content-Security-Policy', value: "default-src 'none'; style-src 'unsafe-inline'; img-src https://cdn.4n6ir.com; base-uri 'none'; frame-ancestors 'none'" }],
    };
    if (location) headers.location = [{ key: 'Location', value: location }];
    if (cookies.length) headers['set-cookie'] = cookies.map(value => ({ key: 'Set-Cookie', value }));
    if (body) headers['content-type'] = [{ key: 'Content-Type', value: 'text/html; charset=utf-8' }];
    return { status: String(status), headers, ...(body ? { body } : {}) };
  }

  async function tokenRequest(settings, fields) {
    const body = new URLSearchParams({ client_id: settings.clientId, ...fields }).toString();
    return http('https://auth.4n6ir.com/oauth2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
        'content-length': Buffer.byteLength(body),
      },
      body,
    });
  }

  function startLogin(settings, host) {
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({
      response_type: 'code', client_id: settings.clientId, redirect_uri: `https://${host}/callback`,
      scope: 'openid email profile', state, nonce, code_challenge_method: 'S256', code_challenge: challenge,
    });
    return response(302, '', `https://auth.4n6ir.com/oauth2/authorize?${query}`, [
      cookie('flow', seal({ state, verifier, nonce, expires: now() + 600000 }, settings.clientSecret, host), 600),
      cookie('id', '', 0), cookie('refresh', '', 0),
    ]);
  }

  function page(title, content, account = '') {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | 4n6ir.com</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:50px;background:#fff;color:#727272;font:14px/1.5 "Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif}
a{color:#267cb9;text-decoration:none}a:hover,a:focus{color:#069;text-decoration:underline}
.signout{border:0;padding:0;background:none;color:#267cb9;font:inherit;cursor:pointer}.signout:hover,.signout:focus-visible{color:#069;text-decoration:underline}
.signout-form{display:inline}
.wrapper{max-width:860px;margin:0 auto}
.topbar{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:20px;min-height:32px;margin-bottom:20px;overflow-wrap:anywhere}
.layout{display:grid;grid-template-columns:270px minmax(0,500px);justify-content:space-between;gap:40px}
.brand img{display:block;width:270px;max-width:100%}
h2{color:#393939;font-size:21px;line-height:1.1;margin:0 0 20px}
p{margin:0 0 20px}.content{padding-bottom:50px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin-bottom:30px}
.tile{display:flex;align-items:center;justify-content:center;min-height:86px;padding:20px;border:1px solid #d5e0e7;border-radius:8px;background:#f8fafb;color:#267cb9;font-size:16px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,.06);transition:background .15s,border-color .15s,box-shadow .15s}
.tile:hover,.tile:focus-visible{border-color:#267cb9;background:#eef5f9;box-shadow:0 4px 10px rgba(0,0,0,.1);text-decoration:none}
.tile:focus-visible{outline:2px solid #267cb9;outline-offset:3px}
.applications h3{color:#393939;font-size:16px;margin:0 0 15px}
footer{position:fixed;bottom:50px;width:270px}
@media(max-width:960px){.layout{grid-template-columns:1fr;gap:20px}.content{border:1px solid #e5e5e5;border-width:1px 0;padding:20px 0;margin-bottom:20px}footer{position:static;width:auto}}
@media(max-width:480px){body{padding:15px}.topbar{gap:10px}}
</style></head><body><div class="wrapper">
<div class="topbar">${account}</div>
<div class="layout"><header class="brand"><img src="https://cdn.4n6ir.com/uglygreen.png" alt="4n6ir logo"></header>
<main class="content"><h2>Forensic Incident Response</h2>
<section aria-label="Public resources">
<div class="tiles"><a class="tile" href="https://blog.4n6ir.com">Blog</a><a class="tile" href="https://github.com/4n6ir">GitHub</a></div></section>
${content}</main></div><footer><p>&copy; ${new Date(now()).getUTCFullYear()} <a href="https://4n6ir.com">4n6ir.com</a></p></footer>
</div></body></html>`;
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
  }

  function authorized(claims) {
    return Array.isArray(claims['cognito:groups']) && claims['cognito:groups'].includes('DashboardUsers');
  }

  function accessDenied() {
    return page('Forensic Incident Response', '<p>Your account does not have access to the dashboard. Contact your administrator for access.</p>', '<form class="signout-form" method="POST" action="/logout"><button class="signout" type="submit">Sign out</button></form>');
  }

  function sessionCookies(tokens, settings, host, expires) {
    if (typeof tokens.id_token !== 'string' || typeof tokens.refresh_token !== 'string') {
      throw new Error('Cognito token response is incomplete');
    }
    return [
      cookie('id', tokens.id_token, Math.max(0, Math.floor((expires - now()) / 1000))),
      cookie('refresh', seal({ token: tokens.refresh_token, expires }, settings.clientSecret, host),
        Math.max(0, Math.floor((expires - now()) / 1000))),
    ];
  }

  return async event => {
    try {
      const request = event.Records[0].cf.request;
      const host = request.headers.host?.[0]?.value?.toLowerCase();
      if (host !== '4n6ir.com' && host !== 'www.4n6ir.com') return response(400, 'Invalid host');
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) return response(405, 'Method not allowed');
      if (request.method === 'HEAD' || (request.method === 'POST' && request.uri !== '/logout')) return response(405, 'Method not allowed');
      const settings = await config();
      const cookies = {};
      for (const header of request.headers.cookie || []) {
        for (const pair of header.value.split(';')) {
          const index = pair.indexOf('=');
          if (index >= 0) {
            const name = pair.slice(0, index).trim();
            if (name.startsWith('__Host-') && cookies[name] !== undefined) return response(400, 'Duplicate cookie');
            cookies[name] = pair.slice(index + 1).trim();
          }
        }
      }
      if (request.uri === '/logout') {
        if (request.method !== 'POST') return response(405, 'Method not allowed');
        const origin = request.headers.origin?.[0]?.value;
        const referer = request.headers.referer?.[0]?.value;
        const allowedOrigin = `https://${host}`;
        const hasAllowedOrigin = origin === allowedOrigin || (origin === undefined && referer?.startsWith(`${allowedOrigin}/`));
        if (!hasAllowedOrigin) return response(403, 'Invalid sign-out request');
        const refresh = unseal(cookies['__Host-refresh'] || '', settings.clientSecret, host);
        if (cookies['__Host-refresh'] && (!refresh || typeof refresh.token !== 'string' || !refresh.token)) {
          console.error('Unable to read dashboard refresh token for sign-out');
          return response(503, 'Sign-out failed. Please try again.');
        }
        if (refresh) {
          const body = new URLSearchParams({ token: refresh.token }).toString();
          let result;
          try {
            result = await http('https://auth.4n6ir.com/oauth2/revoke', {
              method: 'POST',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
                'authorization': `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
                'content-length': Buffer.byteLength(body),
              },
              body,
            });
          } catch (error) {
            console.error('Cognito token revocation request failed:', error.name);
            return response(503, 'Sign-out failed. Please try again.');
          }
          if (result.status !== 200) {
            console.error('Cognito token revocation failed:', result.status);
            return response(503, 'Sign-out failed. Please try again.');
          }
        }
        const query = new URLSearchParams({ client_id: settings.clientId, logout_uri: `https://${host}/` });
        return response(302, '', `https://auth.4n6ir.com/logout?${query}`, [
          cookie('flow', '', 0), cookie('id', '', 0), cookie('refresh', '', 0),
        ]);
      }
      if (request.uri === '/login') return startLogin(settings, host);
      if (request.uri === '/callback') {
        const query = new URLSearchParams(request.querystring || '');
        const flow = unseal(cookies['__Host-flow'] || '', settings.clientSecret, host);
        if (!flow || flow.expires <= now() || query.getAll('state').length !== 1 ||
            query.get('state') !== flow.state || query.getAll('code').length !== 1) {
          return response(400, 'Invalid or expired sign-in request');
        }
        const result = await tokenRequest(settings, {
          grant_type: 'authorization_code', code: query.get('code'),
          redirect_uri: `https://${host}/callback`, code_verifier: flow.verifier,
        });
        if (result.status !== 200) {
          console.error('Cognito authorization code exchange failed:', result.status);
          return response(502, 'Sign-in failed');
        }
        const claims = await verify(result.body.id_token, settings, flow.nonce);
        if (claims.exp <= now() / 1000) throw new InvalidToken('Expired token');
        if (!authorized(claims)) {
          return response(403, accessDenied(), null, [cookie('flow', '', 0)]);
        }
        return response(302, '', '/', [
          cookie('flow', '', 0), ...sessionCookies(result.body, settings, host, now() + 86400000),
        ]);
      }
      let claims;
      if (cookies['__Host-id']) {
        try {
          claims = await verify(cookies['__Host-id'], settings);
        } catch (error) {
          if (!(error instanceof InvalidToken)) throw error;
        }
      }
      let updatedCookies = [];
      if (claims && claims.exp <= now() / 1000) {
        const refresh = unseal(cookies['__Host-refresh'] || '', settings.clientSecret, host);
        if (refresh && typeof refresh.token === 'string' && refresh.expires > now()) {
          const result = await tokenRequest(settings, { grant_type: 'refresh_token', refresh_token: refresh.token });
          if (result.status === 200) {
            claims = await verify(result.body.id_token, settings);
            if (claims.exp <= now() / 1000) throw new InvalidToken('Expired refreshed token');
            updatedCookies = sessionCookies(result.body, settings, host, refresh.expires);
          } else if (result.status >= 400 && result.status < 500) {
            console.error('Cognito refresh rejected:', result.status);
            claims = null;
          } else {
            throw new Error(`Cognito refresh failed: ${result.status}`);
          }
        } else {
          claims = null;
        }
      }
      if (!claims) {
        if (request.uri === '/') {
          return response(200, page('Forensic Incident Response', '', '<a href="/login">Sign in</a>'));
        }
        return startLogin(settings, host);
      }
      if (!authorized(claims)) {
        return response(403, accessDenied(), null, [cookie('id', '', 0), cookie('refresh', '', 0)]);
      }
      if (typeof claims.email !== 'string' || !claims.email) {
        console.error('Dashboard ID token is missing an email claim');
        return response(403, page('Forensic Incident Response', '<p>Your account email is unavailable. Contact your administrator.</p>', '<form class="signout-form" method="POST" action="/logout"><button class="signout" type="submit">Sign out</button></form>'), null, updatedCookies);
      }
      if (request.uri !== '/') return response(404, 'Not found', null, updatedCookies);
      return response(200, page('Forensic Incident Response', '<section class="applications" aria-labelledby="applications-heading"><h3 id="applications-heading">Applications</h3><p>No applications available.</p></section>', `<span>${escapeHtml(claims.email)}</span><form class="signout-form" method="POST" action="/logout"><button class="signout" type="submit">Sign out</button></form>`), null, updatedCookies);
    } catch (error) {
      console.error('Dashboard authentication error:', error.name);
      return response(503, 'Authentication service unavailable');
    }
  };
}

const loadConfiguration = createConfigurationLoader({
  loadIssuer: loadIssuerForRegion,
  loadCredentials: loadCredentialsForRegion,
});

exports.handler = createHandler({ configuration: loadConfiguration, http: requestJson });
exports.createHandler = createHandler;
exports.createConfigurationLoader = createConfigurationLoader;
exports.loadIssuerForRegion = loadIssuerForRegion;
