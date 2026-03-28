# better-auth-cloudflare-email-plugin

Send emails through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) from [Better Auth](https://better-auth.com) — with zero configuration for each callback.

Two transports, one interface:

- **`cloudflareEmail.workers()`** — inside a Cloudflare Worker, uses the `send_email` binding directly (no API key, zero network hop)
- **`cloudflareEmail.api()`** — from any runtime (Node.js, Bun, Deno, Vercel, etc.), uses the Cloudflare REST API

Both wire into all 6 Better Auth email callbacks automatically and ship with clean, responsive HTML templates out of the box.

## Callbacks handled

| Callback | Source | Triggered by |
|---|---|---|
| `sendVerificationEmail` | Core config | Sign-up, manual verify |
| `sendResetPassword` | Core config | Password reset request |
| `sendChangeEmailConfirmation` | Core config | Email change request |
| `sendDeleteAccountVerification` | Core config | Account deletion request |
| `sendMagicLink` | `magicLink()` plugin | Magic link sign-in |
| `sendVerificationOTP` | `emailOTP()` plugin | OTP sign-in / verify / reset |

## Install

```bash
npm install better-auth-cloudflare-email
```

## Quick start

### Cloudflare Workers (binding transport)

```ts
import { betterAuth } from "better-auth";
import { magicLink, emailOTP } from "better-auth/plugins";
import { cloudflareEmail } from "better-auth-cloudflare-email";

function createAuth(env: Env) {
  const email = cloudflareEmail.workers({
    binding: env.EMAIL,
    from: "MyApp <noreply@myapp.com>",
    appName: "MyApp",
  });

  return betterAuth({
    ...email.config,
    plugins: [
      magicLink({ sendMagicLink: email.sendMagicLink }),
      emailOTP({ sendVerificationOTP: email.sendVerificationOTP }),
    ],
  });
}
```

Add the binding to your `wrangler.jsonc`:

```jsonc
{
  "send_email": [{ "name": "EMAIL" }]
}
```

### Any runtime (REST API transport)

```ts
import { betterAuth } from "better-auth";
import { magicLink, emailOTP } from "better-auth/plugins";
import { cloudflareEmail } from "better-auth-cloudflare-email";

const email = cloudflareEmail.api({
  accountId: process.env.CF_ACCOUNT_ID!,
  apiToken: process.env.CF_API_TOKEN!,
  from: "MyApp <noreply@myapp.com>",
  appName: "MyApp",
});

export const auth = betterAuth({
  ...email.config,
  plugins: [
    magicLink({ sendMagicLink: email.sendMagicLink }),
    emailOTP({ sendVerificationOTP: email.sendVerificationOTP }),
  ],
});
```

## How it works

`cloudflareEmail.workers()` and `cloudflareEmail.api()` both return the same object:

```ts
{
  // Spread into betterAuth() — wires verification, reset, change email, delete account
  config: { emailVerification, emailAndPassword, user },

  // Wire into plugins manually
  sendMagicLink,
  sendVerificationOTP,

  // Individual callbacks (if you prefer manual wiring)
  sendVerificationEmail,
  sendResetPassword,
  sendChangeEmailConfirmation,
  sendDeleteAccountVerification,

  // Send any arbitrary email
  sendRaw(message: EmailMessage): Promise<EmailSendResult>,
}
```

The `config` object is designed to be spread into your `betterAuth()` call. Override any defaults after spreading:

```ts
const email = cloudflareEmail.workers({ binding: env.EMAIL, from: "..." });

export const auth = betterAuth({
  ...email.config,
  emailAndPassword: {
    ...email.config.emailAndPassword,
    requireEmailVerification: true,  // your override
    minPasswordLength: 12,           // your override
  },
});
```

## Hono + Workers example

```ts
import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { cloudflareEmail } from "better-auth-cloudflare-email";

interface Env {
  EMAIL: import("better-auth-cloudflare-email").EmailBinding;
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const email = cloudflareEmail.workers({
    binding: c.env.EMAIL,
    from: "MyApp <noreply@myapp.com>",
  });

  const auth = betterAuth({
    ...email.config,
    // database, plugins, etc.
  });

  return auth.handler(c.req.raw);
});

export default app;
```

### Singleton auth with dynamic binding

If you don't want to create auth per-request, pass a function that resolves the binding at call time:

```ts
import { getRequestContext } from "@cloudflare/next-on-pages";
import { cloudflareEmail } from "better-auth-cloudflare-email";

const email = cloudflareEmail.workers({
  binding: () => getRequestContext().env.EMAIL,
  from: "MyApp <noreply@myapp.com>",
});

export const auth = betterAuth({ ...email.config });
```

## Custom templates

Override any template by passing a function that returns `{ subject, html, text }`:

```ts
const email = cloudflareEmail.workers({
  binding: env.EMAIL,
  from: "MyApp <noreply@myapp.com>",
  appName: "MyApp",
  templates: {
    verifyEmail: ({ appName, url, userName }) => ({
      subject: `Welcome to ${appName}!`,
      html: `<h1>Hey ${userName}!</h1><a href="${url}">Verify your email</a>`,
      text: `Verify your email: ${url}`,
    }),
    // resetPassword, changeEmail, deleteAccount, magicLink, otp
  },
});
```

### Template data available

| Field | Type | Available in |
|---|---|---|
| `appName` | `string` | All templates |
| `url` | `string` | All except `otp` |
| `token` | `string` | All except `otp` |
| `userName` | `string \| undefined` | `verifyEmail`, `resetPassword` |
| `otp` | `string` | `otp` only |
| `email` | `string` | `magicLink`, `otp` |

## Sending arbitrary emails

Use `sendRaw` to send any email outside of Better Auth's callbacks:

```ts
await email.sendRaw({
  to: "user@example.com",
  from: "support@myapp.com",
  subject: "Your invoice",
  html: "<p>Thanks for your purchase.</p>",
  text: "Thanks for your purchase.",
  attachments: [{
    filename: "invoice.pdf",
    content: base64String,
    type: "application/pdf",
    disposition: "attachment",
  }],
});
```

## Transport comparison

| | `cloudflareEmail.workers()` | `cloudflareEmail.api()` |
|---|---|---|
| Runtime | Cloudflare Workers only | Any (Node, Bun, Deno, Vercel...) |
| Auth | `send_email` binding (no key) | `CF_ACCOUNT_ID` + `CF_API_TOKEN` |
| Latency | In-process, zero hop | HTTP round-trip to Cloudflare API |
| Config | `binding: env.EMAIL` | `accountId` + `apiToken` |
| Output | Identical | Identical |

## Cloudflare Email Service setup

1. Your domain must use [Cloudflare DNS](https://developers.cloudflare.com/dns/)
2. Go to **Cloudflare Dashboard > Compute & AI > Email Service > Email Sending**
3. Select your domain and add the required DNS records (SPF, DKIM)
4. For the REST API transport, create an [API token](https://dash.cloudflare.com/profile/api-tokens) with email send permissions

> Cloudflare Email Service is currently in **private beta**. It requires a Workers Paid plan.

## License

MIT
