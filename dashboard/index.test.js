'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createConfigurationLoader, createHandler, loadIssuerForRegion } = require('./index');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig' };
const settings = {
  issuer: 'https://issuer-cognito-idp.us-east-1.amazonaws.com/us-east-1_Test',
  clientId: 'clientid',
  clientSecret: 'clientsecret',
};

function request(uri = '/', host = '4n6ir.com', cookies = [], querystring = '', method = uri === '/logout' ? 'POST' : 'GET') {
  return { Records: [{ cf: { request: {
    uri, method, querystring,
    headers: {
      host: [{ value: host }],
      cookie: [{ value: cookies.join('; ') }],
      ...(method === 'POST' ? { origin: [{ value: `https://${host}` }] } : {}),
    },
  } } }] };
}

function cookies(response) {
  return (response.headers['set-cookie'] || []).map(header => header.value.split(';')[0]);
}

function location(response) {
  return response.headers.location[0].value;
}

function signedToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

test('discovers and reads the shared issuer by ARN in either region', async () => {
  for (const region of ['us-east-1', 'us-west-2']) {
    const arn = `arn:aws:ssm:${region}:123456789012:parameter/cognito/issuer`;
    const calls = [];
    class DescribeParametersCommand {
      constructor(input) { this.input = input; }
    }
    class GetParameterCommand {
      constructor(input) { this.input = input; }
    }
    const clients = {
      DescribeParametersCommand,
      GetParameterCommand,
      ssm: {
        async send(command) {
          calls.push(command);
          if (command instanceof DescribeParametersCommand) {
            return command.input.NextToken
              ? { Parameters: [{ Name: '/cognito/issuer', ARN: arn }] }
              : { Parameters: [], NextToken: 'next' };
          }
          assert.ok(command instanceof GetParameterCommand);
          assert.deepEqual(command.input, { Name: arn });
          return { Parameter: { Value: settings.issuer } };
        },
      },
    };
    assert.equal(await loadIssuerForRegion(region, clients), settings.issuer);
    assert.deepEqual(calls[0].input, {
      Shared: true,
      ParameterFilters: [{ Key: 'Name', Option: 'Equals', Values: ['/cognito/issuer'] }],
    });
    assert.equal(calls[1].input.NextToken, 'next');
    assert.equal(calls.length, 3);
  }
});

test('rejects missing or ambiguous shared issuer parameters', async () => {
  class DescribeParametersCommand {
    constructor(input) { this.input = input; }
  }
  for (const parameters of [
    [],
    [
      { Name: '/cognito/issuer', ARN: 'arn:one' },
      { Name: '/cognito/issuer', ARN: 'arn:two' },
    ],
  ]) {
    const clients = {
      DescribeParametersCommand,
      ssm: { send: async () => ({ Parameters: parameters }) },
    };
    await assert.rejects(loadIssuerForRegion('us-east-1', clients), /shared Cognito parameters?/);
  }
});

test('loads issuer and credentials from the replica when primary lookups fail', async () => {
  const issuerRegions = [];
  const credentialRegions = [];
  const configuration = createConfigurationLoader({
    loadIssuer: async region => {
      issuerRegions.push(region);
      if (region === 'us-east-1') throw new Error('primary SSM unavailable');
      return settings.issuer;
    },
    loadCredentials: async region => {
      credentialRegions.push(region);
      if (region === 'us-east-1') throw new Error('primary Secrets Manager unavailable');
      return { clientId: settings.clientId, clientSecret: settings.clientSecret };
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await configuration(), settings);
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(issuerRegions, ['us-east-1', 'us-west-2']);
  assert.deepEqual(credentialRegions, ['us-east-1', 'us-west-2']);
});

function fixture(claimOverrides = {}) {
  let time = 1700000000000;
  let nonce;
  let challenge;
  let refreshes = 0;
  const revoked = [];
  let revokeFailure;
  let outage = false;
  let primaryJwksOutage = false;
  const jwksRequests = [];
  const handler = createHandler({
    now: () => time,
    configuration: async () => settings,
    http: async (url, options) => {
      if (outage) throw new Error('test outage');
      if (url.endsWith('/.well-known/jwks.json')) {
        jwksRequests.push(url);
        if (primaryJwksOutage && url.includes('issuer-cognito-idp.us-east-1')) {
          throw new Error('primary JWKS unavailable');
        }
        return { status: 200, body: { keys: [jwk] } };
      }
      if (url === 'https://auth.4n6ir.com/oauth2/revoke') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.authorization, `Basic ${Buffer.from('clientid:clientsecret').toString('base64')}`);
        assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
        revoked.push(new URLSearchParams(options.body).get('token'));
        if (revokeFailure === 'network') throw new Error('test outage');
        return { status: revokeFailure || 200, body: null };
      }
      assert.equal(url, 'https://auth.4n6ir.com/oauth2/token');
      const fields = new URLSearchParams(options.body);
      assert.equal(options.headers.authorization, `Basic ${Buffer.from('clientid:clientsecret').toString('base64')}`);
      if (fields.get('grant_type') === 'authorization_code') {
        assert.equal(crypto.createHash('sha256').update(fields.get('code_verifier')).digest('base64url'), challenge);
        assert.match(fields.get('redirect_uri'), /^https:\/\/(www\.)?4n6ir\.com\/callback$/);
      } else {
        assert.equal(fields.get('refresh_token'), `refresh-${refreshes}`);
        refreshes++;
      }
      const claims = {
        iss: settings.issuer, aud: settings.clientId, token_use: 'id',
        iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 900, nonce,
        email: 'customer@example.com', 'cognito:groups': ['DashboardUsers'], ...claimOverrides,
      };
      return { status: 200, body: { id_token: signedToken(claims), refresh_token: `refresh-${refreshes}` } };
    },
  });
  return {
    handler,
    advance: milliseconds => { time += milliseconds; },
    outage: () => { outage = true; },
    primaryJwksOutage: () => { primaryJwksOutage = true; },
    setClaims: claims => { Object.assign(claimOverrides, claims); },
    failRevocation: failure => { revokeFailure = failure; },
    revoked,
    jwksRequests,
    prepare(start) {
      const url = new URL(location(start));
      nonce = url.searchParams.get('nonce');
      challenge = url.searchParams.get('code_challenge');
      return url;
    },
    async login(host = '4n6ir.com') {
      const start = await handler(request('/login', host));
      assert.equal(start.status, '302');
      for (const header of start.headers['set-cookie']) {
        assert.match(header.value, /; Path=\/; Secure; HttpOnly; SameSite=Lax;/);
      }
      const url = this.prepare(start);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const query = new URLSearchParams({ state: url.searchParams.get('state'), code: 'code' });
      const callback = await handler(request('/callback', host, cookies(start), query.toString()));
      assert.equal(callback.status, '302');
      assert.equal(location(callback), '/');
      return cookies(callback).filter(value => !value.startsWith('__Host-flow='));
    },
  };
}

test('validates tokens with replica JWKS when the primary issuer endpoint is unavailable', async () => {
  const f = fixture();
  f.primaryJwksOutage();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await f.login();
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(f.jwksRequests, [
    'https://issuer-cognito-idp.us-east-1.amazonaws.com/us-east-1_Test/.well-known/jwks.json',
    'https://issuer-cognito-idp.us-west-2.amazonaws.com/us-east-1_Test/.well-known/jwks.json',
  ]);
});

test('shows consistent signed-out and signed-in pages with account links in the top bar', async () => {
  const f = fixture();
  const signedOut = await f.handler(request());
  assert.equal(signedOut.status, '200');
  assert.match(signedOut.body, /<main class="content"><h2>Forensic Incident Response<\/h2>/);
  assert.match(signedOut.body, /<div class="topbar"><a href="\/login">Sign in<\/a><\/div>/);
  assert.doesNotMatch(signedOut.body, /<section class="applications"/);
  assert.doesNotMatch(signedOut.body, /Sign in to access your applications/);
  assert.doesNotMatch(signedOut.body, />Public resources</);
  const session = await f.login();
  const page = await f.handler(request('/', '4n6ir.com', session));
  assert.equal(page.status, '200');
  assert.match(page.body, /<main class="content"><h2>Forensic Incident Response<\/h2>/);
  assert.match(page.body, /<div class="topbar"><span>customer@example\.com<\/span><form class="signout-form" method="POST" action="\/logout"><button class="signout" type="submit">Sign out<\/button><\/form><\/div>/);
  for (const body of [signedOut.body, page.body]) {
    assert.match(body, /<a class="tile" href="https:\/\/blog\.4n6ir\.com">Blog<\/a>/);
    assert.match(body, /<a class="tile" href="https:\/\/github\.com\/4n6ir">GitHub<\/a>/);
  }
  assert.match(page.body, /<section class="applications" aria-labelledby="applications-heading"><h3 id="applications-heading">Applications<\/h3><p>No applications available\.<\/p><\/section>/);
  assert.ok(page.body.indexOf('aria-label="Public resources"') < page.body.indexOf('<section class="applications"'));
  assert.equal(page.headers['cache-control'][0].value, 'no-store');
  assert.equal((await f.handler(request('/missing', '4n6ir.com', session))).status, '404');
  const wwwSession = await f.login('www.4n6ir.com');
  assert.equal((await f.handler(request('/', 'www.4n6ir.com', wwwSession))).status, '200');
});

test('requires DashboardUsers at sign-in and on every request, including refresh', async () => {
  for (const groups of [undefined, [], ['OtherUsers'], 'DashboardUsers']) {
    const f = fixture({ 'cognito:groups': groups });
    const start = await f.handler(request('/login'));
    const state = f.prepare(start).searchParams.get('state');
    const callback = await f.handler(request('/callback', '4n6ir.com', cookies(start), `state=${state}&code=x`));
    assert.equal(callback.status, '403');
    assert.match(callback.body, /does not have access/);
    assert.match(callback.body, /<div class="topbar"><form class="signout-form" method="POST" action="\/logout"><button class="signout" type="submit">Sign out<\/button><\/form><\/div>/);
    assert.match(callback.body, /href="https:\/\/blog\.4n6ir\.com">Blog<\/a>/);
    assert.match(callback.body, /href="https:\/\/github\.com\/4n6ir">GitHub<\/a>/);
    assert.doesNotMatch(callback.body, /<section class="applications"/);
    assert.ok(!cookies(callback).some(value => value.startsWith('__Host-id=')));
  }
  const f = fixture();
  const session = await f.login();
  const deniedToken = signedToken({
    iss: settings.issuer, aud: settings.clientId, token_use: 'id',
    iat: 1700000000, exp: 1700000900, email: 'customer@example.com', 'cognito:groups': ['OtherUsers'],
  });
  assert.equal((await f.handler(request('/', '4n6ir.com', [`__Host-id=${deniedToken}`]))).status, '403');
  f.setClaims({ 'cognito:groups': ['OtherUsers'] });
  f.advance(901000);
  const denied = await f.handler(request('/', '4n6ir.com', session));
  assert.equal(denied.status, '403');
  assert.ok(cookies(denied).includes('__Host-refresh='));
});

test('escapes the account email and rejects a missing email claim', async () => {
  const f = fixture({ email: '<script>alert("x")</script>&' });
  const page = await f.handler(request('/', '4n6ir.com', await f.login()));
  assert.match(page.body, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(page.body, /<script>/i);
  const missing = fixture({ email: undefined });
  const session = await missing.login();
  const originalLog = console.error;
  console.error = () => {};
  try {
    assert.equal((await missing.handler(request('/', '4n6ir.com', session))).status, '403');
  } finally {
    console.error = originalLog;
  }
});

test('sign-out clears the local session and ends managed login on both hosts', async () => {
  for (const host of ['4n6ir.com', 'www.4n6ir.com']) {
    const f = fixture();
    const session = await f.login(host);
    assert.equal((await f.handler(request('/logout', host, session, '', 'GET'))).status, '405');
    const crossOrigin = request('/logout', host, session);
    crossOrigin.Records[0].cf.request.headers.origin = [{ value: 'https://attacker.example' }];
    assert.equal((await f.handler(crossOrigin)).status, '403');
    const logout = await f.handler(request('/logout', host, session));
    assert.deepEqual(f.revoked, ['refresh-0']);
    const url = new URL(location(logout));
    assert.equal(`${url.origin}${url.pathname}`, 'https://auth.4n6ir.com/logout');
    assert.equal(url.searchParams.get('client_id'), settings.clientId);
    assert.equal(url.searchParams.get('logout_uri'), `https://${host}/`);
    assert.ok(cookies(logout).includes('__Host-id='));
    assert.ok(cookies(logout).includes('__Host-refresh='));
    const page = await f.handler(request('/', host));
    assert.equal(page.status, '200');
    assert.match(page.body, /<div class="topbar"><a href="\/login">Sign in<\/a><\/div>/);
    const login = await f.handler(request('/login', host));
    assert.equal(new URL(location(login)).pathname, '/oauth2/authorize');
  }
});

test('revokes the rotated refresh token and reports revocation failure without discarding it', async () => {
  const f = fixture();
  const session = await f.login();
  f.advance(901000);
  const rotated = cookies(await f.handler(request('/', '4n6ir.com', session)));
  const originalLog = console.error;
  console.error = () => {};
  try {
    for (const failure of [500, 'network']) {
      f.failRevocation(failure);
      const result = await f.handler(request('/logout', '4n6ir.com', rotated));
      assert.equal(result.status, '503');
      assert.match(result.body, /Sign-out failed/);
      assert.equal(result.headers['set-cookie'], undefined);
    }
    f.failRevocation(undefined);
    assert.equal((await f.handler(request('/logout', '4n6ir.com', rotated))).status, '302');
    assert.deepEqual(f.revoked, ['refresh-1', 'refresh-1', 'refresh-1']);
  } finally {
    console.error = originalLog;
  }
});

test('allows sign-out without a refresh cookie but rejects an unreadable one', async () => {
  const f = fixture();
  assert.equal((await f.handler(request('/logout'))).status, '302');
  assert.deepEqual(f.revoked, []);
  const originalLog = console.error;
  console.error = () => {};
  try {
    const result = await f.handler(request('/logout', '4n6ir.com', ['__Host-refresh=invalid']));
    assert.equal(result.status, '503');
    assert.equal(result.headers['set-cookie'], undefined);
  } finally {
    console.error = originalLog;
  }
});

test('rejects callback state tampering and host substitution', async () => {
  const f = fixture();
  const start = await f.handler(request('/login'));
  const state = new URL(location(start)).searchParams.get('state');
  assert.equal((await f.handler(request('/callback', '4n6ir.com', cookies(start), 'state=wrong&code=x'))).status, '400');
  assert.equal((await f.handler(request('/callback', 'www.4n6ir.com', cookies(start), `state=${state}&code=x`))).status, '400');
  assert.equal((await f.handler(request('/', 'attacker.example'))).status, '400');
  f.advance(600001);
  assert.equal((await f.handler(request('/callback', '4n6ir.com', cookies(start), `state=${state}&code=x`))).status, '400');
});

test('refreshes expired tokens and respects the original session limit', async () => {
  const f = fixture();
  const session = await f.login();
  f.advance(901000);
  const page = await f.handler(request('/', '4n6ir.com', session));
  assert.equal(page.status, '200');
  const rotated = cookies(page);
  assert.equal(rotated.length, 2);
  f.advance(901000);
  assert.equal((await f.handler(request('/', '4n6ir.com', rotated))).status, '200');
  f.advance(86400000);
  const expired = await f.handler(request('/', '4n6ir.com', rotated));
  assert.equal(expired.status, '200');
  assert.match(expired.body, /<div class="topbar"><a href="\/login">Sign in<\/a><\/div>/);
});

test('rejects forged tokens and fails closed during a key service outage', async () => {
  const f = fixture();
  const session = await f.login();
  const id = session.find(value => value.startsWith('__Host-id='));
  const [header, payload] = id.slice('__Host-id='.length).split('.');
  const forged = `${header}.${payload}.${Buffer.alloc(256).toString('base64url')}`;
  const forgedPage = await f.handler(request('/', '4n6ir.com', [`__Host-id=${forged}`]));
  assert.equal(forgedPage.status, '200');
  assert.match(forgedPage.body, /<div class="topbar"><a href="\/login">Sign in<\/a><\/div>/);
  assert.doesNotMatch(forgedPage.body, /<section class="applications"/);
  const other = fixture();
  other.outage();
  const oldLog = console.error;
  const oldWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    assert.equal((await other.handler(request('/', '4n6ir.com', session))).status, '503');
  } finally {
    console.error = oldLog;
    console.warn = oldWarn;
  }
});

test('rejects signed tokens with invalid issuer, audience, use, or nonce', async () => {
  const originalLog = console.error;
  console.error = () => {};
  try {
    for (const claims of [
      { iss: 'https://wrong.example' },
      { aud: 'another-client' },
      { token_use: 'access' },
      { nonce: 'wrong' },
    ]) {
      const f = fixture(claims);
      const start = await f.handler(request('/login'));
      const state = f.prepare(start).searchParams.get('state');
      const callback = await f.handler(request('/callback', '4n6ir.com', cookies(start), `state=${state}&code=x`));
      assert.equal(callback.status, '503');
    }
  } finally {
    console.error = originalLog;
  }
});
