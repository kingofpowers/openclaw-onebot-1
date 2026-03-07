/**
 * OneBot 配置解析
 */

import type { OneBotAccountConfig } from "./types.js";

export function getOneBotConfig(api: any, accountId?: string): OneBotAccountConfig | null {
  const cfg = api?.config ?? (globalThis as any).__onebotGatewayConfig;
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

  if (channel?.host && channel?.port) {
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

export function listAccountIds(apiOrCfg: any): string[] {
  const cfg = apiOrCfg?.config ?? apiOrCfg ?? (globalThis as any).__onebotGatewayConfig;
  const accounts = cfg?.channels?.onebot?.accounts;
  if (accounts && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  if (cfg?.channels?.onebot?.host) return ["default"];
  return [];
}
