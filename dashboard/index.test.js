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

function request(uri = '/', host = '4n6ir.com', cookies = [], querystring = '') {
  return { Records: [{ cf: { request: {
    uri, method: 'GET', querystring,
    headers: { host: [{ value: host }], cookie: [{ value: cookies.join('; ') }] },
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
        iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 900, nonce, ...claimOverrides,
      };
      return { status: 200, body: { id_token: signedToken(claims), refresh_token: `refresh-${refreshes}` } };
    },
  });
  return {
    handler,
    advance: milliseconds => { time += milliseconds; },
    outage: () => { outage = true; },
    primaryJwksOutage: () => { primaryJwksOutage = true; },
    jwksRequests,
    prepare(start) {
      const url = new URL(location(start));
      nonce = url.searchParams.get('nonce');
      challenge = url.searchParams.get('code_challenge');
      return url;
    },
    async login(host = '4n6ir.com') {
      const start = await handler(request('/', host));
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

test('sign-in validates PKCE and serves only authenticated visitors', async () => {
  const f = fixture();
  const session = await f.login();
  const page = await f.handler(request('/', '4n6ir.com', session));
  assert.equal(page.status, '200');
  assert.match(page.body, /Authenticated/);
  assert.equal(page.headers['cache-control'][0].value, 'no-store');
  assert.equal((await f.handler(request('/missing', '4n6ir.com', session))).status, '404');
  const wwwSession = await f.login('www.4n6ir.com');
  assert.equal((await f.handler(request('/', 'www.4n6ir.com', wwwSession))).status, '200');
});

test('rejects callback state tampering and host substitution', async () => {
  const f = fixture();
  const start = await f.handler(request());
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
  assert.equal((await f.handler(request('/', '4n6ir.com', rotated))).status, '302');
});

test('rejects forged tokens and fails closed during a key service outage', async () => {
  const f = fixture();
  const session = await f.login();
  const id = session.find(value => value.startsWith('__Host-id='));
  const [header, payload] = id.slice('__Host-id='.length).split('.');
  const forged = `${header}.${payload}.${Buffer.alloc(256).toString('base64url')}`;
  assert.equal((await f.handler(request('/', '4n6ir.com', [`__Host-id=${forged}`]))).status, '302');
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
      const start = await f.handler(request());
      const state = f.prepare(start).searchParams.get('state');
      const callback = await f.handler(request('/callback', '4n6ir.com', cookies(start), `state=${state}&code=x`));
      assert.equal(callback.status, '503');
    }
  } finally {
    console.error = originalLog;
  }
});
