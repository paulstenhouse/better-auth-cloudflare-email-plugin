/**
 * Examples: using cloudflareEmail with Better Auth.
 * Two transports — same interface, same result shape.
 */

import { betterAuth } from "better-auth";
import { magicLink, emailOTP } from "better-auth/plugins";
import { cloudflareEmail } from "./cloudflare-email";

// ═══════════════════════════════════════════════════════════════════════════
// 1. WORKERS TRANSPORT — inside a Cloudflare Worker
// ═══════════════════════════════════════════════════════════════════════════

// wrangler.jsonc:
//   { "send_email": [{ "name": "EMAIL" }] }

interface Env {
	EMAIL: import("./cloudflare-email").EmailBinding;
	DB: D1Database;
}

// --- Option A: per-request auth factory (recommended) ---

function createAuth(env: Env) {
	const email = cloudflareEmail.workers({
		binding: env.EMAIL,
		from: "AttendVIP <noreply@attendvip.com>",
		appName: "AttendVIP",
	});

	return betterAuth({
		...email.config,
		plugins: [
			magicLink({ sendMagicLink: email.sendMagicLink }),
			emailOTP({ sendVerificationOTP: email.sendVerificationOTP }),
		],
		emailAndPassword: {
			...email.config.emailAndPassword,
			requireEmailVerification: true,
		},
	});
}

// Hono handler:
//
// import { Hono } from "hono";
// const app = new Hono<{ Bindings: Env }>();
// app.on(["POST", "GET"], "/api/auth/*", (c) => {
//   return createAuth(c.env).handler(c.req.raw);
// });

// --- Option B: singleton auth with dynamic binding ---

// import { getRequestContext } from "@cloudflare/next-on-pages";
//
// const email = cloudflareEmail.workers({
//   binding: () => getRequestContext().env.EMAIL,
//   from: "AttendVIP <noreply@attendvip.com>",
//   appName: "AttendVIP",
// });
//
// export const auth = betterAuth({ ...email.config });

// ═══════════════════════════════════════════════════════════════════════════
// 2. REST API TRANSPORT — Node.js, Bun, Deno, Vercel, anywhere
// ═══════════════════════════════════════════════════════════════════════════

const email = cloudflareEmail.api({
	accountId: process.env.CF_ACCOUNT_ID!,
	apiToken: process.env.CF_API_TOKEN!,
	from: "AttendVIP <noreply@attendvip.com>",
	appName: "AttendVIP",
});

export const auth = betterAuth({
	...email.config,
	plugins: [
		magicLink({ sendMagicLink: email.sendMagicLink }),
		emailOTP({ sendVerificationOTP: email.sendVerificationOTP }),
	],
	emailAndPassword: {
		...email.config.emailAndPassword,
		requireEmailVerification: true,
	},
});
