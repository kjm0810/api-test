import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import cors from "cors";
import bcrypt from "bcryptjs";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { createClient } from "redis";
import { Server } from "socket.io";
import { compress } from "snappyjs";
import { z } from "zod";

const port = Number(process.env.PORT ?? 3000);
const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "5.104.82.219",
  port: Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_NAME ?? "test",
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  connectionLimit: 10,
  charset: "utf8mb4",
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN ?? "*" },
  transports: ["websocket"],
});
const overlayNs = io.of("/overlay");

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "256kb" }));

type AuthRequest = Request & { userId?: number };
type ApiKeyRow = RowDataPacket & { user_id: number };
type LinkRow = RowDataPacket & { platform: "soop" | "chzzk"; streamer_id: string };
type UserRow = RowDataPacket & { id: number; name: string; email: string; password_hash: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const room = (platform: string, streamerId: string) => `stream:${platform}:${streamerId}`;
const jwtSecret = process.env.JWT_SECRET ?? "development-only-secret";
const createAccessToken = (userId: number) => jwt.sign({ sub: String(userId) }, jwtSecret, { expiresIn: "7d" });

async function issueApiKey(userId: number) {
  const rawKey = `sk_live_${randomBytes(24).toString("base64url")}`;
  await pool.execute("INSERT INTO api_keys(user_id,key_prefix,key_hash) VALUES(?,?,?)",
    [userId, rawKey.slice(0, 16), sha256(rawKey)]);
  return rawKey;
}

function authenticateToken(token?: string) {
  if (!token) return null;
  try { return Number(jwt.verify(token, jwtSecret).sub); } catch { return null; }
}

async function authenticate(apiKey?: string) {
  if (!apiKey) return null;
  const [rows] = await pool.query<ApiKeyRow[]>(`
    SELECT ak.user_id FROM api_keys ak
    JOIN users u ON u.id=ak.user_id
    WHERE ak.key_hash=? AND ak.active=TRUE AND u.active=TRUE
      AND (ak.expires_at IS NULL OR ak.expires_at > NOW()) LIMIT 1`, [sha256(apiKey)]);
  if (!rows[0]) return null;
  void pool.execute("UPDATE api_keys SET last_used_at=NOW(3) WHERE key_hash=?", [sha256(apiKey)]);
  return rows[0].user_id;
}

async function auth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const userId = authenticateToken(bearer)
      ?? await authenticate(bearer)
      ?? await authenticate(req.header("x-api-key") ?? undefined);
    if (!userId) return res.status(401).json({ error: "invalid_credentials" });
    req.userId = userId;
    next();
  } catch (error) { next(error); }
}

const commonEventSchema = z.object({
  _id: z.string(), platform: z.enum(["soop", "chzzk"]), streamer_id: z.string(),
  streamer_nickname: z.string(),
  user_id: z.string().default(""), nickname: z.string().default(""), message: z.string().default(""),
  extras: z.unknown().default({}), createdAt: z.string(), ttl: z.string(), __v: z.number().int().default(0),
});
const eventSchema = z.discriminatedUnion("type", [
  commonEventSchema.extend({ type: z.literal("chat") }),
  commonEventSchema.extend({
    type: z.literal("donation"), cnt: z.number().int().nonnegative(),
    amount: z.number().int().nonnegative(),
  }),
]);
type StreamEvent = z.infer<typeof eventSchema>;

const overlaySubscribeSchema = z.array(z.object({
  platform: z.enum(["soop", "chzzk"]), id: z.string().min(1).max(100),
})).max(50);

function publish(input: unknown) {
  const event = eventSchema.parse(input);
  const payload = compress(Buffer.from(JSON.stringify(event), "utf8"));
  const eventRoom = room(event.platform, event.streamer_id);
  io.to(eventRoom).emit(event.type, payload);
  overlayNs.to(eventRoom).emit(event.type, payload);
}

// 서버 상태 체크
app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", sockets: io.engine.clientsCount });
});

// API 시스템 회원가입
app.post("/auth/signup", async (req, res) => {
  const input = z.object({ name: z.string().min(2).max(100), email: z.email(), password: z.string().min(8).max(72) }).parse(req.body);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const [result] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users(name,email,password_hash) VALUES(?,?,?)", [input.name, input.email.toLowerCase(), passwordHash]);
    const rawKey = `sk_live_${randomBytes(24).toString("base64url")}`;
    await connection.execute("INSERT INTO api_keys(user_id,key_prefix,key_hash) VALUES(?,?,?)",
      [result.insertId, rawKey.slice(0, 16), sha256(rawKey)]);
    await connection.commit();
    res.status(201).json({
      accessToken: createAccessToken(result.insertId), apiKey: rawKey,
      user: { id: result.insertId, name: input.name, email: input.email.toLowerCase() }
    });
  } catch (error) {
    await connection.rollback();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") return res.status(409).json({ error: "email_already_exists" });
    throw error;
  } finally { connection.release(); }
});

// API 시스템 로그인
app.post("/auth/login", async (req, res) => {
  const input = z.object({ email: z.email(), password: z.string().min(1) }).parse(req.body);
  const [rows] = await pool.query<UserRow[]>(
    "SELECT id,name,email,password_hash FROM users WHERE email=? AND active=TRUE LIMIT 1", [input.email.toLowerCase()]);
  const user = rows[0];
  if (!user || !await bcrypt.compare(input.password, user.password_hash))
    return res.status(401).json({ error: "invalid_email_or_password" });
  res.json({ accessToken: createAccessToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
});

// API 시스템 유저 정보 req 기반
app.get("/api/v1/me", auth, async (req: AuthRequest, res) => {
  const [rows] = await pool.query<UserRow[]>("SELECT id,name,email FROM users WHERE id=?", [req.userId]);
  res.json({ user: rows[0] });
});

// API 시스템 유저의 API key 조회
app.get("/api/v1/api-keys", auth, async (req: AuthRequest, res) => {
  const [rows] = await pool.query("SELECT id,key_prefix,active,last_used_at,created_at FROM api_keys WHERE user_id=? ORDER BY id DESC", [req.userId]);
  res.json({ result: rows });
});

app.post("/internal/events", (req, res) => {
  if (req.header("x-internal-secret") !== process.env.INTERNAL_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  publish(req.body);
  res.status(202).json({ accepted: true });
});

app.post("/admin/users/:userId/api-keys", async (req, res) => {
  if (req.header("x-admin-secret") !== process.env.ADMIN_SECRET)
    return res.status(401).json({ error: "unauthorized" });
  res.status(201).json({ apiKey: await issueApiKey(Number(req.params.userId)) });
});


// 유저 <-> 스트리머 연결에 대한 요청
app.get("/api/v1/streamers", auth, async (req: AuthRequest, res) => {
  const [rows] = await pool.query("SELECT platform,streamer_id FROM streamer_links WHERE user_id=?", [req.userId]);
  res.json({ result: rows });
});

app.post("/api/v1/streamers", auth, async (req: AuthRequest, res) => {
  const input = z.object({ platform: z.enum(["soop", "chzzk"]), streamerId: z.string().min(1).max(100) }).parse(req.body);
  await pool.execute("INSERT IGNORE INTO streamer_links(user_id,platform,streamer_id) VALUES(?,?,?)",
    [req.userId!, input.platform, input.streamerId]);
  res.status(201).json(input);
});

app.delete("/api/v1/streamers/:platform/:streamerId", auth, async (req: AuthRequest, res) => {
  await pool.execute("DELETE FROM streamer_links WHERE user_id=? AND platform=? AND streamer_id=?",
    [req.userId!, req.params.platform, req.params.streamerId]);
  res.status(204).end();
});
// 유저 <-> 스트리머 연결에 대한 요청

// --------------- 외부에 제공할 API-----------------
// --------------- 외부에 제공할 API-----------------
// --------------- 외부에 제공할 API-----------------
app.get("/donations/polling", auth, async (req: AuthRequest, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  const params: unknown[] = [req.userId];
  let cursorSql = "";
  if (cursor) { cursorSql = "AND (d.created_at,d._id) < (SELECT created_at,_id FROM donations WHERE _id=?)"; params.push(cursor); }
  params.push(limit);
  const [rows] = await pool.query<RowDataPacket[]>(`
    SELECT d.* FROM donations d JOIN streamer_links sl
      ON sl.user_id=? AND sl.platform=d.platform AND sl.streamer_id=d.streamer_id
    WHERE 1=1 ${cursorSql} ORDER BY d.created_at DESC,d._id DESC LIMIT ?`, params);
  res.json({
    error: 0,
    currentCursor: cursor,
    nextCursor: rows.length === limit ? (rows.at(-1)?._id ?? null) : null,
    result: rows,
    length: rows.length,
  });
});
// --------------- 외부에 제공할 API-----------------
// --------------- 외부에 제공할 API-----------------
// --------------- 외부에 제공할 API-----------------


// 소켓
io.on("connection", async (socket) => {
  const login = async (userId: number) => {
    if (socket.data.userId) return;
    socket.data.userId = userId;
    const [links] = await pool.query<LinkRow[]>("SELECT platform,streamer_id FROM streamer_links WHERE user_id=?", [userId]);
    await socket.join(links.map((link) => room(link.platform, link.streamer_id)));
    socket.emit("ready", { streamers: links });
  };

  const loginTimeout = setTimeout(() => {
    if (!socket.data.userId) socket.disconnect(true);
  }, 10_000);

  socket.on("login", async (apiKey: unknown) => {
    try {
      const userId = await authenticate(typeof apiKey === "string" ? apiKey : undefined);
      if (!userId) return socket.emit("login_error", { error: "invalid_api_key" });
      await login(userId);
      clearTimeout(loginTimeout);
    } catch {
      socket.emit("login_error", { error: "authentication_failed" });
    }
  });
  socket.on("ping", () => socket.emit("pong"));
  socket.on("disconnect", () => clearTimeout(loginTimeout));
});

if (process.env.REDIS_URL) {
  const redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", (error) => console.error("Redis error", error));
  await redis.connect();
  await redis.subscribe("collector.events", (message) => {
    try { publish(JSON.parse(message) as StreamEvent); } catch (error) { console.error("Invalid event", error); }
  });
}



app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(error instanceof z.ZodError ? 400 : 500).json({ error: error instanceof Error ? error.message : "server_error" });
});

server.listen(port, () => console.log(`REST + Socket.IO listening on http://5.104.82.219:${port}`));
