/**
 * OneBot 配置解析
 */

import { readFileSync, existsSync } from "fs";
import type { OneBotAccountConfig } from "./types.js";

// 配置缓存（仅在文件变化时更新）
let cachedConfig: any = null;

/**
 * 清除配置缓存（在检测到文件变化时调用）
 */
export function invalidateConfigCache(): void {
  cachedConfig = null;
}

/**
 * 从文件读取最新配置（仅在缓存失效时读取）
 */
export function getLiveConfig(): any {
  if (cachedConfig) {
    return cachedConfig;
  }

  const possiblePaths = [
    process.env.OPENCLAW_CONFIG,
    "/home/node/.openclaw/openclaw.json",
    "/app/openclaw.json",
  ].filter(Boolean);

  for (const path of possiblePaths) {
    try {
      if (existsSync(path)) {
        const content = readFileSync(path, "utf-8");
        cachedConfig = JSON.parse(content);
        return cachedConfig;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 获取实时的 OneBot channel 配置（从文件读取，支持热加载）
 */
export function getLiveOneBotChannelConfig(): any {
  const cfg = getLiveConfig();
  return cfg?.channels?.onebot ?? {};
}

export function getOneBotConfig(api: any, accountId?: string): OneBotAccountConfig | null {
  // 使用实时配置（支持热加载）
  const cfg = getLiveConfig() ?? api?.config ?? (globalThis as any).__onebotGatewayConfig;
  const id = accountId ?? "default";

  const channel = cfg?.channels?.onebot;
  const account = channel?.accounts?.[id];
  if (account) {
    const { type, host, port, accessToken, path } = account;
    if (host && port) {
      return {
        accountId: id,
        type: type ?? "forward-websocket",
        host,
        port,
        accessToken,
        path: path ?? "/onebot/v11/ws",
        enabled: account.enabled !== false,
      };
    }
  }

  // 只有当请求 "default" 时才使用全局配置作为 fallback
  if (id === "default" && channel?.host && channel?.port) {
    return {
      accountId: id,
      type: channel.type ?? "forward-websocket",
      host: channel.host,
      port: channel.port,
      accessToken: channel.accessToken,
      path: channel.path ?? "/onebot/v11/ws",
    };
  }

  const type = process.env.ONEBOT_WS_TYPE as "forward-websocket" | "backward-websocket" | undefined;
  const host = process.env.ONEBOT_WS_HOST;
  const portStr = process.env.ONEBOT_WS_PORT;
  const accessToken = process.env.ONEBOT_WS_ACCESS_TOKEN;
  const path = process.env.ONEBOT_WS_PATH ?? "/onebot/v11/ws";

  if (host && portStr) {
    const port = parseInt(portStr, 10);
    if (Number.isFinite(port)) {
      return {
        accountId: id,
        type: type === "backward-websocket" ? "backward-websocket" : "forward-websocket",
        host,
        port,
        accessToken: accessToken || undefined,
        path,
      };
    }
  }

  return null;
}

/** 是否将机器人回复中的 Markdown 渲染为纯文本再发送，默认 true */
export function getRenderMarkdownToPlain(cfg: any): boolean {
  const v = cfg?.channels?.onebot?.renderMarkdownToPlain;
  return v === undefined ? true : Boolean(v);
}

/** 是否将连续多个换行压缩为单个换行，默认 true（AI 常输出 \n\n 导致双空行） */
export function getCollapseDoubleNewlines(cfg: any): boolean {
  const v = cfg?.channels?.onebot?.collapseDoubleNewlines;
  return v === undefined ? true : Boolean(v);
}

/** 白名单 QQ 号列表，为空则所有人可回复；非空则仅白名单内用户可触发 AI */
export function getWhitelistUserIds(cfg: any): number[] {
  const v = cfg?.channels?.onebot?.whitelistUserIds;
  if (!Array.isArray(v)) return [];
  return v.filter((x: unknown) => typeof x === "number" || (typeof x === "string" && /^\d+$/.test(x))).map((x) => Number(x));
}

/**
 * OG 图片渲染主题：枚举 default（无额外样式）、dust（内置）、custom（使用 ogImageRenderThemePath）
 * 返回用于 getMarkdownStyles 的值：default | dust | 自定义 CSS 绝对路径
 */
export function getOgImageRenderTheme(cfg: any): "default" | "dust" | string {
  const v = cfg?.channels?.onebot?.ogImageRenderTheme;
  const path = (cfg?.channels?.onebot?.ogImageRenderThemePath ?? "").trim();
  if (v === "dust") return "dust";
  if (v === "custom" && path.length > 0) return path;
  return "default";
}

export function listAccountIds(apiOrCfg: any): string[] {
  // 优先使用实时配置
  let cfg = getLiveConfig();
  
  // 如果实时配置没有 accounts，尝试从 api.config 获取
  if (!cfg?.channels?.onebot?.accounts) {
    cfg = apiOrCfg?.config ?? apiOrCfg ?? (globalThis as any).__onebotGatewayConfig;
  }
  
  const accounts = cfg?.channels?.onebot?.accounts;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  if (cfg?.channels?.onebot?.host) return ["default"];
  return [];
}
