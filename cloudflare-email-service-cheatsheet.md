# Cloudflare Email Service Cheat Sheet

> **Status:** Private Beta | **Plan:** Workers Paid | **Requirement:** Cloudflare DNS

---

## Quick Start

### 1. Onboard Domain (Dashboard)

`Compute & AI > Email Service > Email Sending > Onboard Domain`

Adds SPF, DKIM, and MX records automatically. DNS propagation: 5-15 min on CF DNS.

### 2. Create a Worker

```sh
npm create cloudflare@latest -- email-service-tutorial
# Select "Hello World" Worker template
```

### 3. Configure Bindings (`wrangler.jsonc`)

```jsonc
{
  "name": "email-sending-worker",
  "compatibility_date": "2024-01-01",
  "send_email": [
    { "name": "EMAIL" }           // unrestricted sender
    // { "name": "EMAIL", "allowed_from": ["noreply@yourdomain.com"] }  // restricted
  ]
}
```

TOML equivalent:

```toml
[[send_email]]
name = "EMAIL"
```

### 4. Send an Email

```ts
export default {
  async fetch(request, env, ctx) {
    const response = await env.EMAIL.send({
      to: "recipient@example.com",
      from: "hello@yourdomain.com",
      subject: "Hello!",
      html: "<h1>Hello from Cloudflare</h1>",
      text: "Hello from Cloudflare",
    });
    return new Response(JSON.stringify({ success: true, id: response.messageId }));
  },
};
```

### 5. Deploy

```sh
npm run deploy
```

---

## Sending Emails

### Workers API: `env.EMAIL.send(message)`

```ts
interface EmailMessage {
  to: string | string[];        // required
  from: string;                 // required
  subject: string;              // required
  html?: string;                // max 10 MB
  text?: string;                // max 10 MB
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Attachment[];
}

interface Attachment {
  filename: string;
  content: string;              // base64-encoded
  contentType: string;          // MIME type
  disposition: "attachment" | "inline";
  contentId?: string;           // for inline images, referenced via cid:
}
```

**Max 50 recipients** per message (to + cc + bcc combined).

### Workers API: `env.EMAIL.sendBatch(messages[])`

Send multiple emails in one call. Returns per-message success/failure.

### REST API

```sh
POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email-service/send
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{
  "to": "user@example.com",
  "from": "hello@yourdomain.com",
  "subject": "Hello",
  "html": "<p>Hello</p>",
  "text": "Hello"
}
```

### Error Handling

```ts
try {
  await env.EMAIL.send(message);
} catch (e) {
  // e is EmailSendError with .code and .message
}
```

Error codes: `E_VALIDATION_ERROR`, `E_SENDER_NOT_VERIFIED`, `E_RATE_LIMIT_EXCEEDED`, `E_HEADER_NOT_ALLOWED`, `E_HEADER_USE_API_FIELD`, `E_HEADER_VALUE_INVALID`, `E_HEADER_VALUE_TOO_LONG`, `E_HEADERS_TOO_LARGE`, `E_HEADERS_TOO_MANY`

---

## Routing Emails (Inbound)

### Dashboard Route

`Compute & AI > Email Service > Email Routing > Routing Rules > Create Address`

Actions: **Send to an email** | **Send to a Worker** | **Drop**

### Worker Email Handler

```ts
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    // message.from, message.to, message.headers, message.raw (ReadableStream), message.rawSize

    // Forward
    await message.forward("admin@company.com", { "X-Custom": "value" });

    // Reply
    await env.EMAIL.send({
      to: message.from,
      from: `noreply@yourdomain.com`,
      subject: "Auto-reply",
      text: "We received your email.",
    });

    // Reject
    message.setReject("550 Not accepted");
  },
};
```

### Catch-All & Subaddressing

- **Catch-all:** `Email > Email Routing > Routes` - enable catch-all to handle typos/unknown addresses
- **Subaddressing (RFC 5233):** `user+detail@domain.com` routes to `user@domain.com` rules. Enable at `Email > Email Routing > Settings`

---

## DNS Records

### Sending

| Record | Name | Value |
|--------|------|-------|
| TXT (SPF) | `yourdomain.com` | `v=spf1 include:_spf.cloudflare.com ~all` |
| TXT (DKIM) | `selector._domainkey.yourdomain.com` | `v=DKIM1; k=rsa; p=...` (auto-generated) |
| TXT (DMARC) | `_dmarc.yourdomain.com` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com` |

### Routing (Inbound)

| Record | Value |
|--------|-------|
| MX | 3 Cloudflare servers at priorities 15, 70, 96 |
| TXT (SPF) | `include:_spf.mx.cloudflare.net` |
| TXT (DKIM) | Separate selector, e.g. `cf2024-1._domainkey` |
| TXT | `v=CF-EMAIL-ROUTING` |

### DMARC Rollout Strategy

`p=none` (monitor) -> `p=quarantine` (isolate) -> `p=reject` (block)

---

## Attachments

```ts
// Standard attachment
{ filename: "invoice.pdf", content: base64String, contentType: "application/pdf", disposition: "attachment" }

// Inline image (reference in HTML as <img src="cid:logo">)
{ filename: "logo.png", content: base64String, contentType: "image/png", disposition: "inline", contentId: "logo" }
```

**Limits:** max 10 files, 25 MB total per message.

---

## Custom Headers

**Whitelisted categories:**
- Threading: `In-Reply-To`, `References`
- List mgmt: `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id`, `Precedence`
- Automation: `Auto-Submitted` (`auto-generated`, `auto-replied`, `auto-notified`)
- Display: `Content-Language`, `Importance`, `Sensitivity`, `Organization`
- Any `X-*` header (e.g. `X-My-Custom-Header`)

**Constraints:** max 20 non-X headers, names 1-100 chars ASCII, values max 2048 bytes UTF-8, total payload 16 KB.

Platform-controlled (cannot override): `Date`, `Message-ID`, `MIME-Version`, `Content-Type`, `DKIM-Signature`, `Return-Path`, `Received`.

---

## Limits

| Metric | New Account (<2mo) | Established (>2mo) | Production Access |
|--------|-------------------|-------------------|-------------------|
| Daily sends | 100 | 1,000 | 10,000 |
| Hourly sends | 10 | 100 | 10,000 |
| Monthly sends | 10,000 | 10,000 | 10,000 |

| Constraint | Limit |
|------------|-------|
| Recipients per email | 100 (to+cc+bcc) |
| Subject length | 998 chars |
| Text/HTML body | 10 MB each |
| Attachments | 10 files, 25 MB total |
| Custom headers total | 64 KB |
| Workers CPU | 50 ms/request |
| Workers subrequests | 50/request (includes email ops) |
| Workers memory | 128 MB |

Contact support for higher limits.

---

## Pricing

| Feature | Free | Paid |
|---------|------|------|
| Outbound sending | No | Yes |
| Outbound to verified account addresses | Unlimited | Unlimited |
| Inbound routing | Unlimited | Unlimited |

Email Routing Workers billed per Workers pricing.

---

## Sandboxing & Production Access

- **Sandbox (default):** Can only send to verified account email addresses. For testing.
- **Production:** Submit the Production Access Form. Only transactional use cases approved.

---

## Suppression Lists

- **Global (Cloudflare-managed):** Hard bounces, repeated failures, legal blocks across shared IP pool
- **Account-level:** Spam complaints, manual additions. Review monthly.

**Auto-suppressed:** hard bounces, repeated soft bounces, spam complaints.

---

## Deliverability Targets

| Metric | Target |
|--------|--------|
| Delivery rate | > 95% |
| Hard bounce rate | < 2% |
| Complaint rate | < 0.1% |

**Best practices:** Avoid spam trigger words (FREE, URGENT, GUARANTEED), include both HTML + text, validate addresses before sending, implement double opt-in, remove hard-bounced addresses immediately.

---

## Observability

### Logs (Dashboard)

`Compute & AI > Email Service > [domain] > Activity Log`

**Outbound statuses:** Sent, Delivered, Bounced, Failed
**Inbound statuses:** Forwarded, Dropped, Rejected, Processed

Filter by status, date, sender/recipient, auth results.

### Metrics (GraphQL API)

Dataset: `emailSendingAdaptiveGroups` (31-day retention)

Query delivery counts, latency percentiles (P25/P50/P75/P90/P99), grouped by date and status.

---

## Local Development

```sh
npx wrangler dev
```

- **Sending:** Emails written to local `.eml` files instead of actually sent
- **Routing:** Test with curl:

```sh
# Test sending
curl -X POST http://localhost:8787/ \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","from":"hello@yourdomain.com","subject":"Test","text":"Hello"}'

# Test routing
curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=sender@test.com&to=support@yourdomain.com" \
  -d 'From: sender@test.com\r\nSubject: Test\r\n\r\nBody here'
```

---

## Postmaster Info

| Item | Value |
|------|-------|
| SPF include | `_spf.email.cloudflare.net` |
| IPv4 range | `104.30.0.0/19` |
| IPv6 range | `2405:8100:c000::/38` |
| Outbound hostnames | `cloudflare-email.net`, `cloudflare-email.org`, `cloudflare-email.com` |
| DKIM query | `dig TXT cf2024-1._domainkey.example.com +short` |
| Abuse contact | `abuse@cloudflare.com` |

---

## Common Patterns

### Magic Link Auth

```ts
const token = crypto.randomUUID();
// Store token in KV with TTL
await env.TOKENS.put(token, email, { expirationTtl: 900 }); // 15 min

await env.EMAIL.send({
  to: email,
  from: `noreply@${env.DOMAIN}`,
  subject: "Your login link",
  html: `<a href="https://${env.DOMAIN}/login?token=${token}">Log in</a>`,
  text: `Log in: https://${env.DOMAIN}/login?token=${token}`,
});
```

### Signup + Email Verification

```ts
const userId = crypto.randomUUID();
const verifyToken = crypto.randomUUID();
await env.USERS.put(email, JSON.stringify({ id: userId, email, verified: false }));
await env.TOKENS.put(verifyToken, userId, { expirationTtl: 3600 }); // 1 hr

await env.EMAIL.send({
  to: email,
  from: `noreply@${env.DOMAIN}`,
  subject: "Verify your email",
  html: `<a href="https://${env.DOMAIN}/verify?token=${verifyToken}">Verify</a>`,
});
```

### Spam Filter (Routing Worker)

Check subjects for keywords (`buy now`, `limited time`, `act fast`), detect excessive caps (>70%), suspicious punctuation (`!!!`, `$$$`). Add `X-Spam-Score` header and forward or reject.

### Email Storage (Routing Worker)

Parse with `postal-mime`, store in R2/KV, forward to destination.
