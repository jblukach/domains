# domains

This repository contains the Infrastructure-as-Code (AWS CDK in Python) for managing the **4n6ir.com**, **lostmedium.com**, **lukach.io**, and **lukach.net** domains using **GitHub OpenID Connect (OIDC)** and **AWS**.

It provides secure, credential-free deployments, full DNS management, CloudFront distributions, domain redirects, and long-term DNS query logging.

---

## ✨ Features

### 🔐 GitHub OpenID Connect (OIDC)
- Secure authentication between GitHub Actions and AWS.
- Eliminates the need for long-lived IAM access keys.
- IAM role trust scoped to the `jblukach/domains` repository.
- Deployment permissions limited to CloudFormation, S3, KMS (via S3), SSM bootstrap parameters, and CDK `PassRole` in `us-east-1`, `us-east-2`, and `us-west-2`.

---

### 🌐 DNS & Domain Management (Route 53)
- Public hosted zones for **4n6ir.com**, **lostmedium.com**, **lukach.io**, and **lukach.net**.
- Accelerated recovery enabled for all four public hosted zones.
- **13 months of DNS query logging** stored in CloudWatch Logs.
- Fully managed DNS records:
  - **MX** (mail routing)
  - **SPF** (email sender validation)
  - **DKIM** (cryptographic signing, including SES DKIM for dev, beta, and prod)
  - **DMARC** (domain-level email security policy)
  - **NS** (delegated subdomains: `osint.4n6ir.com` and `api.lukach.io`)
  - **TXT** (GitHub organization domain validation)

---

### 🔒 TLS Certificates (ACM)
- Automatically provisioned AWS ACM certificates with DNS validation.
- Supports both apex and subdomains.
- Integrated with CloudFront for HTTPS globally.

---

### 🌎 CloudFront CDN & Functions
- CloudFront distributions serving every domain over **IPv4** and **IPv6** with **HTTP/2 + HTTP/3** and a **TLS 1.3** minimum security policy.
- `4n6ir.com` / `www.4n6ir.com` use Lambda@Edge and Cognito Managed Login at `auth.4n6ir.com` for a customer dashboard restricted to `DashboardUsers`.
- CloudFront Functions for lightweight permanent (HTTP 301) redirects:
  - `lostmedium.com` / `www.lostmedium.com` → `https://github.com/lostmedium`
  - `lukach.io`, `lukach.net`, and `www` variants → `https://github.com/jblukach`
- Static asset CDNs backed by private S3 buckets with Origin Access Control:
  - `https://cdn.4n6ir.com`
  - `https://cdn.lostmedium.com`
  - `https://cdn.lukach.io`
  - `https://cdn.lukach.net`
- Blog subdomains pointed at GitHub Pages:
  - `blog.4n6ir.com` → `4n6ir.github.io`
  - `blog.lukach.io` → `jblukach.github.io`

---

## 🧱 Stacks

| Stack | Purpose |
|-------|---------|
| `DomainsStack` | GitHub OIDC provider and deployment IAM role |
| `Domains4n6irCom` | DNS, certificates, authenticated dashboard, and CDN for 4n6ir.com |
| `DomainsLostMediumCom` | DNS, certificates, and redirects for lostmedium.com |
| `DomainsLukachIo` | DNS, certificates, redirects, and CDN for lukach.io |
| `DomainsLukachNet` | DNS, certificates, and redirects for lukach.net |

All stacks deploy to **us-east-1** using the CDK bootstrap qualifier `lukach`.

---

## 📁 Repository Layout

```
app.py              CDK application entry point
domains/            CDK stack definitions
redirect/           CloudFront Function redirect handlers
dashboard/          Lambda@Edge authentication and landing page
whoami/             CloudFront Function returning the viewer IP
cache/              Static assets deployed to the CDN buckets
.github/workflows/  GitHub Actions deployment workflow
```

---

## 🚀 Deployment

Deployments run automatically via GitHub Actions (`.github/workflows/domains.yaml`):

- On every push to `main`.
- On a monthly schedule to keep resources refreshed.
- Authenticates to AWS with OIDC and runs `cdk deploy --all`.

### 4n6ir dashboard prerequisites

Deploy the [Cognito identity provider](https://github.com/jblukach/cognito) first.
The Cognito account shares `/cognito/issuer`, `/cognito/secret`, and
`/cognito/encrypt` with the Domains account in both `us-east-1` and
`us-west-2`. Both issuer parameters contain the primary pool's updated issuer;
the replica uses the same issuer. The edge function discovers the shared
parameter ARNs, reads the regional Secrets Manager
replica, and tries `us-west-2` if a primary-region lookup fails. The secret
contains the `Dashboard` app client credentials. Cognito's regional KMS key
and secret resource policies must delegate access to the Domains account, as
described in the Cognito repository. The Lambda role is restricted to the
regional Cognito credential secret and KMS use through Secrets Manager.

Accept RAM invitations if needed and verify both regional shares are active.
The Lambda execution role needs `ssm:GetParameter` on the shared issuer
parameter ARN in both Regions, `ssm:DescribeParameters` to discover the shared
parameter ARNs, `ssm:GetParameters` on those ARNs, and regional access to the
replicated secret and KMS key.

The edge handler uses authorization code + PKCE, validates the Cognito ID
token and nonce, checks its `cognito:groups` claim for `DashboardUsers`, and
displays its email claim. Visitors see public Blog and GitHub tiles and can
start sign-in from the upper-right link. Signed-in dashboard members also see
an applications section. It stores the ID and encrypted refresh tokens in
host-only, Secure, HttpOnly cookies and refreshes expired ID tokens for up to
one day. Group changes take effect when a new ID token is issued; existing
tokens can remain usable until they expire. Sign-out revokes the current
refresh token through Cognito, clears the local cookies, and redirects to
Cognito's logout endpoint. Sign-out requires a same-origin POST; the dashboard
only sends referrers on same-origin requests. If revocation fails, sign-out
reports an error and retains the session so it can be retried. Cognito also revokes associated
tokens, but this dashboard validates ID tokens offline and cannot detect
their revocation: a copied ID token can still be used until it expires.
The two hostnames have separate local sessions; signing out on one does not
revoke the other's refresh token.
Before deployment, Cognito must disable self-registration for `DashboardUsers`
and grant that group only through an explicit administrator approval process.
Membership alone is not an authorization boundary if users can grant the group
to themselves during sign-up.

The dashboard currently shows an empty applications section: Cognito's ID
token provides group membership but not a catalog of app clients, display
names, launch URLs, or required groups. For future tiles, the Cognito project
should provide an authenticated, non-secret app catalog mapping each app to
its launch URL and required group, with an explicit policy for users with
multiple groups. The dashboard can then filter that catalog using validated
claims. Each destination application must independently enforce its own
authorization; hiding a tile is not access control. Do not expose app-client
secrets in the catalog or browser.

The `auth.4n6ir.com` Managed Login domain already routes to the Cognito
replica based on the health check configured by the Cognito repository. Keep
using that domain for authorize and token requests; the pool replica shares
the app client and primary issuer. On cold starts or configuration-cache
refresh, the edge function independently tries each Region for the issuer and
the client secret, and loads signing keys from either Region. If a primary SSM,
Secrets Manager, or JWKS lookup is unavailable, it falls back to `us-west-2`.
Configuration is cached in each edge execution environment for five minutes
after a successful load.

The old GitHub redirect is removed rather than preserved. Browsers and
intermediaries may retain the previous permanent 301; clear their caches if
they continue redirecting. Before production, test login and refresh on both
hostnames, regional Cognito failover, access to the cross-account secret, and
edge errors and logs. Synthesis and unit tests do not verify live AWS access.
Run the local edge tests with `node --test dashboard/index.test.js`.

To deploy manually:

```bash
pip install -r requirements.txt
cdk deploy --all
```

To diff all stacks with the `dns` profile, use a quoted stack wildcard.
`cdk diff` and `cdk list` do not accept `--all`:

```bash
cdk diff --profile dns '*'
```

The app defaults the jsii package cache to `~/.jsii-package-cache` to avoid
group-writable shared cache directories. Override it with
`JSII_RUNTIME_PACKAGE_CACHE_ROOT`, or set `JSII_RUNTIME_PACKAGE_CACHE=disabled`
to disable caching. The cache and its parent directories must be owned by you
or root and must not be writable by group or others.
