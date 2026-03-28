/**
 * Better Auth + Cloudflare Email Service integration.
 *
 * Two transports, one interface:
 *
 *   // Inside a Cloudflare Worker — uses the send_email binding (zero latency, no API key)
 *   import { cloudflareEmail } from "better-auth-cloudflare-email";
 *   const email = cloudflareEmail.workers({ binding: env.EMAIL, from: "..." });
 *
 *   // Anywhere else — uses the Cloudflare REST API
 *   import { cloudflareEmail } from "better-auth-cloudflare-email";
 *   const email = cloudflareEmail.api({ accountId: "...", apiToken: "...", from: "..." });
 *
 * Both return the same object shape — spread `email.config` into betterAuth()
 * and wire plugin callbacks identically.
 */

// ---------------------------------------------------------------------------
// Shared types (matches Cloudflare Email Service API spec)
// ---------------------------------------------------------------------------

export type EmailAddress = string | { address: string; name: string };

export interface EmailMessage {
	to: string | string[];
	from: EmailAddress;
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	reply_to?: EmailAddress;
	headers?: Record<string, string>;
	attachments?: EmailAttachment[];
}

export type EmailAttachment = InlineAttachment | StandardAttachment;

export interface InlineAttachment {
	filename: string;
	content: string; // base64
	type: string; // MIME type
	disposition: "inline";
	content_id: string; // referenced in HTML via cid:
}

export interface StandardAttachment {
	filename: string;
	content: string; // base64
	type: string; // MIME type
	disposition: "attachment";
}

export interface EmailSendResult {
	delivered: string[];
	permanent_bounces: string[];
	queued: string[];
}

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

export interface EmailTransport {
	send(message: EmailMessage): Promise<EmailSendResult>;
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export interface TemplateData {
	appName: string;
	url?: string;
	token?: string;
	otp?: string;
	email?: string;
	userName?: string;
}

export type TemplateFn = (data: TemplateData) => { subject: string; html: string; text: string };

export interface Templates {
	verifyEmail?: TemplateFn;
	resetPassword?: TemplateFn;
	changeEmail?: TemplateFn;
	deleteAccount?: TemplateFn;
	magicLink?: TemplateFn;
	otp?: TemplateFn;
}

// ---------------------------------------------------------------------------
// Shared options (transport-agnostic)
// ---------------------------------------------------------------------------

interface SharedOptions {
	/** Default "from" address. String or { address, name }. */
	from: EmailAddress;

	/** Application name shown in email templates. Default: "Our App". */
	appName?: string;

	/** Override default email templates per type. */
	templates?: Templates;
}

// ---------------------------------------------------------------------------
// Workers transport options
// ---------------------------------------------------------------------------

/** Cloudflare Workers send_email binding. */
export interface EmailBinding {
	send(message: EmailMessage): Promise<EmailSendResult>;
	sendBatch?(messages: EmailMessage[]): Promise<{ results: Array<{ success: boolean; error?: string } & Partial<EmailSendResult>> }>;
}

export interface WorkersOptions extends SharedOptions {
	/** The send_email binding, or a function that returns it (for singleton auth). */
	binding: EmailBinding | (() => EmailBinding);
}

// ---------------------------------------------------------------------------
// REST API transport options
// ---------------------------------------------------------------------------

export interface ApiOptions extends SharedOptions {
	/** Cloudflare Account ID. */
	accountId: string;

	/** Cloudflare API Token with email send permissions. */
	apiToken: string;

	/** Override the base URL. Default: "https://api.cloudflare.com/client/v4" */
	baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Default email templates
// ---------------------------------------------------------------------------

function layout(title: string, body: string, appName: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  .wrap{max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .header{background:#18181b;padding:24px 32px;color:#fff;font-size:18px;font-weight:600}
  .body{padding:32px}
  .body p{margin:0 0 16px;color:#3f3f46;line-height:1.6;font-size:15px}
  .btn{display:inline-block;padding:12px 28px;background:#18181b;color:#fff!important;text-decoration:none;border-radius:8px;font-weight:500;font-size:15px}
  .code{display:inline-block;padding:12px 24px;background:#f4f4f5;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:6px;color:#18181b}
  .footer{padding:16px 32px;font-size:12px;color:#a1a1aa;border-top:1px solid #f4f4f5}
</style></head>
<body><div class="wrap">
<div class="header">${appName}</div>
<div class="body">${body}</div>
<div class="footer">You received this email because an action was requested on your account. If you didn't request this, you can safely ignore it.</div>
</div></body></html>`;
}

const defaultTemplates: Required<Templates> = {
	verifyEmail: ({ appName, url, userName }) => ({
		subject: `Verify your email – ${appName}`,
		html: layout(
			"Verify Email",
			`<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>Thanks for signing up. Please verify your email address by clicking the button below.</p>
<p style="text-align:center;margin:24px 0"><a href="${url}" class="btn">Verify Email</a></p>
<p style="font-size:13px;color:#71717a">If the button doesn't work, copy and paste this link into your browser:<br>${url}</p>`,
			appName,
		),
		text: `Verify your email for ${appName}: ${url}`,
	}),

	resetPassword: ({ appName, url, userName }) => ({
		subject: `Reset your password – ${appName}`,
		html: layout(
			"Reset Password",
			`<p>Hi${userName ? ` ${userName}` : ""},</p>
<p>We received a request to reset your password. Click the button below to choose a new one.</p>
<p style="text-align:center;margin:24px 0"><a href="${url}" class="btn">Reset Password</a></p>
<p style="font-size:13px;color:#71717a">This link expires in 1 hour. If you didn't request a password reset, you can ignore this email.</p>`,
			appName,
		),
		text: `Reset your password for ${appName}: ${url}`,
	}),

	changeEmail: ({ appName, url }) => ({
		subject: `Confirm email change – ${appName}`,
		html: layout(
			"Confirm Email Change",
			`<p>You requested to change the email address on your ${appName} account.</p>
<p>Click the button below to confirm this change.</p>
<p style="text-align:center;margin:24px 0"><a href="${url}" class="btn">Confirm Change</a></p>
<p style="font-size:13px;color:#71717a">If you didn't request this, please secure your account immediately.</p>`,
			appName,
		),
		text: `Confirm email change for ${appName}: ${url}`,
	}),

	deleteAccount: ({ appName, url }) => ({
		subject: `Confirm account deletion – ${appName}`,
		html: layout(
			"Delete Account",
			`<p>You requested to delete your ${appName} account. This action is permanent.</p>
<p>Click the button below to confirm deletion.</p>
<p style="text-align:center;margin:24px 0"><a href="${url}" class="btn" style="background:#dc2626">Delete Account</a></p>
<p style="font-size:13px;color:#71717a">If you didn't request this, please ignore this email and secure your account.</p>`,
			appName,
		),
		text: `Confirm account deletion for ${appName}: ${url}`,
	}),

	magicLink: ({ appName, url }) => ({
		subject: `Sign in to ${appName}`,
		html: layout(
			"Magic Link",
			`<p>Click the button below to sign in to your ${appName} account. This link expires in 15 minutes.</p>
<p style="text-align:center;margin:24px 0"><a href="${url}" class="btn">Sign In</a></p>
<p style="font-size:13px;color:#71717a">If you didn't request this, you can safely ignore this email.</p>`,
			appName,
		),
		text: `Sign in to ${appName}: ${url}`,
	}),

	otp: ({ appName, otp }) => ({
		subject: `Your verification code – ${appName}`,
		html: layout(
			"Verification Code",
			`<p>Use the following code to continue. It expires in 5 minutes.</p>
<p style="text-align:center;margin:24px 0"><span class="code">${otp}</span></p>
<p style="font-size:13px;color:#71717a">If you didn't request this code, you can safely ignore this email.</p>`,
			appName,
		),
		text: `Your ${appName} verification code: ${otp}`,
	}),
};

// ---------------------------------------------------------------------------
// Transport implementations
// ---------------------------------------------------------------------------

function createWorkersTransport(opts: WorkersOptions): EmailTransport {
	return {
		async send(message) {
			const binding = typeof opts.binding === "function" ? opts.binding() : opts.binding;
			return binding.send(message);
		},
	};
}

function createApiTransport(opts: ApiOptions): EmailTransport {
	const baseUrl = opts.baseUrl ?? "https://api.cloudflare.com/client/v4";
	const url = `${baseUrl}/accounts/${opts.accountId}/email-service/send`;

	return {
		async send(message) {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${opts.apiToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(message),
			});

			if (!res.ok) {
				const body = await res.text();
				throw new Error(`Cloudflare Email API error (${res.status}): ${body}`);
			}

			const json = (await res.json()) as {
				success: boolean;
				result?: EmailSendResult;
				errors?: Array<{ code: number; message: string }>;
			};

			if (!json.success) {
				const msg = json.errors?.map((e) => e.message).join(", ") ?? "Unknown error";
				throw new Error(`Cloudflare Email API error: ${msg}`);
			}

			return json.result ?? { delivered: [], permanent_bounces: [], queued: [] };
		},
	};
}

// ---------------------------------------------------------------------------
// Build the Better Auth integration from any transport
// ---------------------------------------------------------------------------

interface CloudflareEmailResult {
	/** Spread into betterAuth() to wire up core email callbacks automatically. */
	config: {
		emailVerification: {
			sendVerificationEmail: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;
			sendOnSignUp: true;
		};
		emailAndPassword: {
			enabled: true;
			sendResetPassword: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;
		};
		user: {
			changeEmail: {
				enabled: true;
				sendChangeEmailConfirmation: (data: { user: { email: string; name?: string }; newEmail: string; url: string; token: string }, request?: Request) => Promise<void>;
			};
			deleteUser: {
				enabled: true;
				sendDeleteAccountVerification: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;
			};
		};
	};

	/** For magicLink() plugin. */
	sendMagicLink: (data: { email: string; url: string; token: string; metadata?: Record<string, unknown> }) => Promise<void>;

	/** For emailOTP() plugin. */
	sendVerificationOTP: (data: { email: string; otp: string; type: string }) => Promise<void>;

	/** Individual callbacks if you prefer manual wiring. */
	sendVerificationEmail: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;
	sendResetPassword: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;
	sendChangeEmailConfirmation: (data: { user: { email: string; name?: string }; newEmail: string; url: string; token: string }, request?: Request) => Promise<void>;
	sendDeleteAccountVerification: (data: { user: { email: string; name?: string }; url: string; token: string }, request?: Request) => Promise<void>;

	/** Send an arbitrary email through the underlying transport. */
	sendRaw: (message: EmailMessage) => Promise<EmailSendResult>;
}

function build(transport: EmailTransport, shared: SharedOptions): CloudflareEmailResult {
	const appName = shared.appName ?? "Our App";
	const from = shared.from;
	const t = { ...defaultTemplates, ...shared.templates };

	function fire(to: string, rendered: { subject: string; html: string; text: string }) {
		void transport.send({ to, from, subject: rendered.subject, html: rendered.html, text: rendered.text });
	}

	const sendVerificationEmail = async (
		data: { user: { email: string; name?: string }; url: string; token: string },
		_request?: Request,
	) => {
		fire(data.user.email, t.verifyEmail({ appName, url: data.url, token: data.token, userName: data.user.name }));
	};

	const sendResetPassword = async (
		data: { user: { email: string; name?: string }; url: string; token: string },
		_request?: Request,
	) => {
		fire(data.user.email, t.resetPassword({ appName, url: data.url, token: data.token, userName: data.user.name }));
	};

	const sendChangeEmailConfirmation = async (
		data: { user: { email: string; name?: string }; newEmail: string; url: string; token: string },
		_request?: Request,
	) => {
		fire(data.newEmail, t.changeEmail({ appName, url: data.url, token: data.token }));
	};

	const sendDeleteAccountVerification = async (
		data: { user: { email: string; name?: string }; url: string; token: string },
		_request?: Request,
	) => {
		fire(data.user.email, t.deleteAccount({ appName, url: data.url, token: data.token }));
	};

	const sendMagicLink = async (
		data: { email: string; url: string; token: string; metadata?: Record<string, unknown> },
	) => {
		fire(data.email, t.magicLink({ appName, url: data.url, token: data.token, email: data.email }));
	};

	const sendVerificationOTP = async (
		data: { email: string; otp: string; type: string },
	) => {
		fire(data.email, t.otp({ appName, otp: data.otp, email: data.email }));
	};

	return {
		config: {
			emailVerification: { sendVerificationEmail, sendOnSignUp: true },
			emailAndPassword: { enabled: true, sendResetPassword },
			user: {
				changeEmail: { enabled: true, sendChangeEmailConfirmation },
				deleteUser: { enabled: true, sendDeleteAccountVerification },
			},
		},
		sendVerificationEmail,
		sendResetPassword,
		sendChangeEmailConfirmation,
		sendDeleteAccountVerification,
		sendMagicLink,
		sendVerificationOTP,
		sendRaw: (message) => transport.send(message),
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const cloudflareEmail = {
	/**
	 * Use inside a Cloudflare Worker — sends via the `send_email` binding.
	 * Zero network hop, no API key needed.
	 *
	 * ```ts
	 * const email = cloudflareEmail.workers({
	 *   binding: env.EMAIL,
	 *   from: "App <noreply@app.com>",
	 * });
	 * ```
	 */
	workers(opts: WorkersOptions): CloudflareEmailResult {
		return build(createWorkersTransport(opts), opts);
	},

	/**
	 * Use from any runtime (Node.js, Bun, Deno, Vercel, etc.) — sends via
	 * the Cloudflare Email Service REST API.
	 *
	 * ```ts
	 * const email = cloudflareEmail.api({
	 *   accountId: process.env.CF_ACCOUNT_ID,
	 *   apiToken: process.env.CF_API_TOKEN,
	 *   from: "App <noreply@app.com>",
	 * });
	 * ```
	 */
	api(opts: ApiOptions): CloudflareEmailResult {
		return build(createApiTransport(opts), opts);
	},
};
