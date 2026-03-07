/**
 * 测试新人入群欢迎
 * 用法：npx tsx scripts/test-group-welcome.ts --group <群号> --user <QQ号>
 * 需先启动 Gateway 并连接 OneBot，或使用 forward-websocket 时本脚本会自行连接
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { handleGroupIncrease } from "../src/handlers/group-increase.js";
import { ensureConnection } from "../src/connection.js";
import { getOneBotConfig } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function loadConfig(configPath?: string): Record<string, unknown> {
  const candidates = [
    configPath ? resolve(process.cwd(), configPath) : null,
    process.env.OPENCLAW_CONFIG,
    resolve(process.cwd(), "openclaw.json"),
    resolve(__dirname, "../../openclaw.json"),
    resolve(__dirname, "../openclaw.json"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) {
      const raw = readFileSync(p, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    }
  }
  throw new Error("未找到 openclaw.json，可通过 --config 指定路径");
}

function parseArgs(): { groupId: number; userId: number; configPath?: string } {
  const args = process.argv.slice(2);
  let groupId = 0;
  let userId = 0;
  let configPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--group" && args[i + 1]) {
      groupId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--user" && args[i + 1]) {
      userId = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--config" && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    }
  }

  if (!groupId || !userId) {
    console.error("用法: npx tsx scripts/test-group-welcome.ts --group <群号> --user <QQ号> [--config openclaw.json]");
    process.exit(1);
  }
  return { groupId, userId, configPath };
}

async function main() {
  const { groupId, userId, configPath } = parseArgs();
  const config = loadConfig(configPath);
  const gi = (config?.channels as Record<string, unknown>)?.onebot as Record<string, unknown> | undefined;
  const groupIncrease = gi?.groupIncrease as Record<string, unknown> | undefined;

  if (!groupIncrease?.enabled) {
    console.error("groupIncrease 未启用，请在 openclaw.json 中配置 channels.onebot.groupIncrease.enabled: true");
    process.exit(1);
  }

  const api = {
    config,
    logger: { info: console.log, warn: console.warn, error: console.error },
  };

  (globalThis as any).__onebotApi = api;
  (globalThis as any).__onebotGatewayConfig = config;

  const getConfig = () => getOneBotConfig(api);
  const obConfig = getConfig();
  if (!obConfig) {
    console.error("OneBot 未配置，请检查 openclaw.json 中的 channels.onebot (host/port) 或环境变量 ONEBOT_WS_*");
    process.exit(1);
  }

  console.log(`[测试欢迎] 群 ${groupId}，模拟用户 ${userId} 入群`);
  console.log("[测试欢迎] 正在连接 OneBot...");

  try {
    await ensureConnection(getConfig, 15000);
  } catch (e: any) {
    console.error("[测试欢迎] 连接失败:", e?.message);
    process.exit(1);
  }

  const fakeMsg = {
    post_type: "notice",
    notice_type: "group_increase",
    group_id: groupId,
    user_id: userId,
  };

  try {
    await handleGroupIncrease(api, fakeMsg as any);
    console.log("[测试欢迎] 完成");
  } catch (e: any) {
    console.error("[测试欢迎] 执行失败:", e?.message);
    process.exit(1);
  }
}

main();
