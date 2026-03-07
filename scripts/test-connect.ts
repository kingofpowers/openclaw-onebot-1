/**
 * OneBot 连接测试脚本
 * 从 .env 或项目根目录 .env 加载 ONEBOT_WS_* 参数，连接 OneBot 并调用 get_login_info 验证
 */
import WebSocket from "ws";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 加载 .env（优先 openclaw-onebot，其次项目根）
function loadEnv() {
  for (const p of [resolve(__dirname, "../.env"), resolve(__dirname, "../../.env")]) {
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      for (const line of content.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) {
          const key = m[1].trim();
          const val = m[2].trim().replace(/^["']|["']$/g, "");
          if (!process.env[key]) process.env[key] = val;
        }
      }
      break;
    }
  }
}
loadEnv();

const type = process.env.ONEBOT_WS_TYPE || "forward-websocket";
const host = process.env.ONEBOT_WS_HOST || "127.0.0.1";
const port = process.env.ONEBOT_WS_PORT || "3001";
const accessToken = process.env.ONEBOT_WS_ACCESS_TOKEN;

console.log("[OneBot Test] 配置:", { type, host, port, hasToken: !!accessToken });

const addr = `ws://${host}:${port}`;
const headers: Record<string, string> = {};
if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

const ws = new WebSocket(addr, { headers });

ws.on("open", () => {
  console.log("[OneBot Test] WebSocket 已连接");

  const echo = `test-${Date.now()}`;
  const payload = { action: "get_login_info", params: {}, echo };

  const resolvePromise = new Promise<any>((resolve) => {
    const handler = (data: Buffer) => {
      try {
        const res = JSON.parse(data.toString());
        if (res.echo === echo) {
          ws.off("message", handler);
          resolve(res);
        }
        if (res.meta_event_type === "heartbeat") return;
      } catch {}
    };
    ws.on("message", handler);

    setTimeout(() => {
      ws.off("message", handler);
      resolve({ error: "timeout" });
    }, 10000);
  });

  ws.send(JSON.stringify(payload));

  resolvePromise.then((res) => {
    if (res.error) {
      console.error("[OneBot Test] 超时或无响应");
      process.exit(1);
    }
    if (res.retcode === 0 && res.data) {
      console.log("[OneBot Test] 连接成功!");
      console.log("[OneBot Test] 登录信息:", res.data);
      console.log("  - user_id:", res.data.user_id);
      console.log("  - nickname:", res.data.nickname);
    } else {
      console.error("[OneBot Test] API 返回异常:", res);
      process.exit(1);
    }
    ws.close();
  });
});

ws.on("error", (err) => {
  console.error("[OneBot Test] 连接错误:", err.message);
  process.exit(1);
});
