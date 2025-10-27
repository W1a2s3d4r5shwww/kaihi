// Server.js
import express from "express";
import axios from "axios";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import { register, collectDefaultMetrics, Counter, Histogram } from "prom-client";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT = Number(process.env.REQUEST_TIMEOUT) || 5000;
const WHITELIST = (process.env.WHITELIST || "").split(",").filter(Boolean);

// ミドルウェア
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(morgan("combined"));
app.use(helmet());

// Prometheusメトリクス
collectDefaultMetrics();
const requestCounter = new Counter({
  name: "proxy_requests_total",
  help: "Total number of proxy requests",
});
const requestDuration = new Histogram({
  name: "proxy_request_duration_seconds",
  help: "Proxy request duration in seconds",
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

// Graceful shutdown
let shuttingDown = false;
const server = app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Server shutting down...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// ユーティリティ
function isValidUrl(input) {
  try {
    const urlObj = new URL(input);
    return ["http:", "https:"].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

function isAllowed(url) {
  if (!WHITELIST.length) return true;
  return WHITELIST.some(domain => url.startsWith(domain));
}

// ルート
app.post("/proxy", async (req, res) => {
  if (shuttingDown) return res.status(503).json({ error: "Server shutting down" });

  const start = Date.now();
  requestCounter.inc();

  const { url, method = "GET", headers = {}, data } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: "Invalid or missing URL" });
  }
  if (!isAllowed(url)) {
    return res.status(403).json({ error: "URL not allowed" });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await axios({
      url,
      method,
      headers,
      data,
      signal: controller.signal,
      validateStatus: null,
    });

    clearTimeout(timeoutId);
    requestDuration.observe((Date.now() - start) / 1000);

    res.status(response.status).json({
      status: response.status,
      headers: response.headers,
      data: response.data,
    });
  } catch (err) {
    requestDuration.observe((Date.now() - start) / 1000);
    if (err.name === "AbortError") return res.status(504).json({ error: "Request timed out" });
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// メトリクス
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

// ヘルスチェック
app.get("/health", (req, res) => res.json({ status: "ok" }));

export default server;
