# domains

This repository contains the Infrastructure-as-Code configuration for managing the **4n6ir.com**, **lukach.io** and **lukach.net** domains using **GitHub OpenID Connect (OIDC)** and **AWS**.

It provides secure, credential-free deployments, full DNS management, CloudFront distribution, domain redirects, and long-term query logging.

---

## ✨ Features

### 🔐 GitHub OpenID Connect (OIDC)
- Secure authentication between GitHub Actions and AWS.
- Eliminates the need for long-lived IAM access keys.
- Fine-grained IAM roles scoped to specific deployments.

---

## 🌐 DNS & Domain Management (Route 53)
- Public hosted zones for **4n6ir.com**, **lukach.io** and **lukach.net**.
- **13 months of DNS query logging** stored in CloudWatch Logs.
- Fully managed DNS records:
  - **MX** (mail routing)
  - **SPF** (email sender validation)
  - **DKIM** (cryptographic signing)
  - **DMARC** (domain-level email security policy)
  - **NS** (delegated subdomains)

---

## 🔒 TLS Certificates (ACM)
- Automatically provisioned AWS ACM certificates.
- Supports both apex and subdomains.
- Integrated with CloudFront for HTTPS globally.

---

## 🌎 CloudFront CDN & Functions
- CloudFront distribution serving content for both domains.
- **IPv4** and **IPv6** enabled.
- CloudFront Function for lightweight redirect logic:
  - Redirect apex → `https://github.com/jblukach` or `https://github.com/4n6ir`
  - Redirect `www` → canonical hostname
- Caching optimized for redirects and static assets.
  - `https://cdn.lukach.io`

---
