import { Hono } from "hono";
import PostalMime from "postal-mime";

interface ForwardableEmailMessage {
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream;
	readonly rawSize: number;
	setReject(reason: string): void;
	forward(rcptTo: string, headers?: Headers): Promise<void>;
	reply(message: EmailMessage): Promise<void>;
}

type Env = {
	EMAIL: {
		send(message: {
			to: string | string[];
			from: string;
			subject: string;
			html?: string;
			text?: string;
		}): Promise<{ messageId: string }>;
	};
	DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
	return c.json({ status: "ok", usage: "POST /send | GET /emails | GET /emails/:id" });
});

app.post("/send", async (c) => {
	const body = await c.req.json<{
		to: string;
		subject?: string;
		html?: string;
		text?: string;
	}>();

	const result = await c.env.EMAIL.send({
		to: body.to,
		from: "rsvp@attend.vip",
		subject: body.subject ?? "Test from attend.vip",
		html: body.html ?? "<h1>Hello from attend.vip</h1><p>Sent via Cloudflare Email Service.</p>",
		text: body.text ?? "Hello from attend.vip — sent via Cloudflare Email Service.",
	});

	return c.json({ success: true, messageId: result.messageId });
});

app.get("/emails", async (c) => {
	const limit = Number(c.req.query("limit") ?? 50);
	const { results } = await c.env.DB.prepare(
		"SELECT id, message_id, sender, recipient, subject, received_at FROM emails ORDER BY received_at DESC LIMIT ?"
	).bind(limit).all();
	return c.json(results);
});

app.get("/emails/:id", async (c) => {
	const id = c.req.param("id");
	const row = await c.env.DB.prepare("SELECT * FROM emails WHERE id = ?").bind(id).first();
	if (!row) return c.json({ error: "not found" }, 404);
	return c.json(row);
});

export default {
	fetch: app.fetch,

	async email(message: ForwardableEmailMessage, env: Env) {
		const subject = message.headers.get("subject") ?? "";
		const messageId = message.headers.get("message-id") ?? "";

		// Parse with postal-mime (handles multipart, base64, quoted-printable, etc.)
		const raw = new Response(message.raw);
		const rawArrayBuffer = await raw.arrayBuffer();
		const parsed = await new PostalMime().parse(rawArrayBuffer);

		await env.DB.prepare(
			`INSERT INTO emails (message_id, sender, recipient, subject, body_text, body_html, raw_size)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).bind(
			messageId,
			message.from,
			message.to,
			subject,
			(parsed.text ?? "").slice(0, 100_000),
			(parsed.html ?? "").slice(0, 100_000),
			message.rawSize,
		).run();

		await message.forward("paul@kardoe.com");
	},
};
