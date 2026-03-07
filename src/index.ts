/**
 * OpenClaw OneBot Channel Plugin
 *
 * 将 OneBot v11 协议（QQ/Lagrange.Core/go-cqhttp）接入 OpenClaw Gateway。
 *
 * 发送逻辑（参照飞书实现）：
 * - 由 OpenClaw 主包解析 `openclaw message send --channel onebot ...` 命令
 * - 根据 --channel 查找已注册的 onebot 渠道，调用其 outbound.sendText / outbound.sendMedia
 * - 不注册 Agent 工具，避免重复实现；Agent 回复时由 process-inbound 的 deliver 自动发送
 */

import { OneBotChannelPlugin } from "./channel.js";
import { registerService } from "./service.js";
import { startImageTempCleanup } from "./connection.js";
import { startForwardCleanupTimer } from "./handlers/process-inbound.js";

export default function register(api: any): void {
  (globalThis as any).__onebotApi = api;
  (globalThis as any).__onebotGatewayConfig = api.config;

  startImageTempCleanup();
  startForwardCleanupTimer();
  api.registerChannel({ plugin: OneBotChannelPlugin });

  if (typeof api.registerCli === "function") {
    api.registerCli(
      (ctx: any) => {
        const prog = ctx.program;
        if (prog && typeof prog.command === "function") {
          const onebot = prog.command("onebot").description("OneBot 渠道配置");
          onebot.command("setup").description("交互式配置 OneBot 连接参数").action(async () => {
            const { runOneBotSetup } = await import("./setup.js");
            await runOneBotSetup();
          });
        }
      },
      { commands: ["onebot"] }
    );
  }

  registerService(api);

  api.logger?.info?.("[onebot] plugin loaded");
}
