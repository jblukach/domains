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
- CloudFront Functions for lightweight redirect logic:
  - `4n6ir.com` / `www.4n6ir.com` → `https://github.com/4n6ir`
  - `lostmedium.com` / `www.lostmedium.com` → `https://github.com/lostmedium`
  - `lukach.io`, `lukach.net`, and `www` variants → `https://github.com/jblukach`
- Static asset CDNs backed by private S3 buckets with Origin Access Control:
  - `https://cdn.4n6ir.com`
  - `https://cdn.lukach.io`
- Blog subdomains pointed at GitHub Pages:
  - `blog.4n6ir.com` → `4n6ir.github.io`
  - `blog.lukach.io` → `jblukach.github.io`

---

## 🧱 Stacks

| Stack | Purpose |
|-------|---------|
| `DomainsStack` | GitHub OIDC provider and deployment IAM role |
| `Domains4n6irCom` | DNS, certificates, redirects, and CDN for 4n6ir.com |
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

To deploy manually:

```bash
pip install -r requirements.txt
cdk deploy --all
```
