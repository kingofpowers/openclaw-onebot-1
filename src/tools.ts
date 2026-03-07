/**
 * Agent 工具注册
 * 供 OpenClaw cron 等场景下，AI 调用 OneBot 能力
 */

import WebSocket from "ws";
import { loadScript } from "./load-script.js";
import {
  getWs,
  sendPrivateMsg,
  sendGroupMsg,
  sendGroupImage,
  sendPrivateImage,
  uploadGroupFile,
  uploadPrivateFile,
  getGroupMsgHistory,
  getGroupInfo,
  getStrangerInfo,
  getGroupMemberInfo,
  getAvatarUrl,
} from "./connection.js";
import { getRenderMarkdownToPlain } from "./config.js";
import { markdownToPlain } from "./markdown.js";

export interface OneBotClient {
  sendGroupMsg: typeof sendGroupMsg;
  sendGroupImage: typeof sendGroupImage;
  sendPrivateMsg: typeof sendPrivateMsg;
  sendPrivateImage: typeof sendPrivateImage;
  getGroupMsgHistory: typeof getGroupMsgHistory;
  getGroupInfo: typeof getGroupInfo;
  getStrangerInfo: typeof getStrangerInfo;
  getGroupMemberInfo: typeof getGroupMemberInfo;
  getAvatarUrl: typeof getAvatarUrl;
}

export const onebotClient: OneBotClient = {
  sendGroupMsg,
  sendGroupImage,
  sendPrivateMsg,
  sendPrivateImage,
  getGroupMsgHistory,
  getGroupInfo,
  getStrangerInfo,
  getGroupMemberInfo,
  getAvatarUrl,
};

export function registerTools(api: any): void {
  if (typeof api.registerTool !== "function") return;

  api.registerTool({
    name: "onebot_send_text",
    description: "通过 OneBot 发送文本消息。target 格式：user:QQ号 或 group:群号",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "user:123456 或 group:789012" },
        text: { type: "string", description: "要发送的文本" },
      },
      required: ["target", "text"],
    },
    async execute(_id: string, params: { target: string; text: string }) {
      const w = getWs();
      if (!w || w.readyState !== WebSocket.OPEN) {
        return { content: [{ type: "text", text: "OneBot 未连接" }] };
      }
      const cfg = (api as any)?.config;
      const textToSend = getRenderMarkdownToPlain(cfg) ? markdownToPlain(params.text) : params.text;
      const t = params.target.replace(/^onebot:/i, "");
      try {
        if (t.startsWith("group:")) {
          await sendGroupMsg(parseInt(t.slice(6), 10), textToSend);
        } else {
          const id = parseInt(t.replace(/^user:/, ""), 10);
          await sendPrivateMsg(id, textToSend);
        }
        return { content: [{ type: "text", text: "发送成功" }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
      }
    },
  });

  api.registerTool({
    name: "onebot_send_image",
    description: "通过 OneBot 发送图片。target 格式：user:QQ号 或 group:群号。image 为本地路径(file://)或 URL 或 base64://",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string" },
        image: { type: "string", description: "图片路径或 URL" },
      },
      required: ["target", "image"],
    },
    async execute(_id: string, params: { target: string; image: string }) {
      const w = getWs();
      if (!w || w.readyState !== WebSocket.OPEN) {
        return { content: [{ type: "text", text: "OneBot 未连接" }] };
      }
      const t = params.target.replace(/^onebot:/i, "");
      try {
        if (t.startsWith("group:")) {
          await sendGroupImage(parseInt(t.slice(6), 10), params.image);
        } else {
          await sendPrivateImage(parseInt(t.replace(/^user:/, ""), 10), params.image);
        }
        return { content: [{ type: "text", text: "图片发送成功" }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
      }
    },
  });

  api.registerTool({
    name: "onebot_upload_file",
    description: "通过 OneBot 上传文件到群或私聊。target: user:QQ号 或 group:群号。file 为本地绝对路径，name 为显示文件名",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string" },
        file: { type: "string" },
        name: { type: "string" },
      },
      required: ["target", "file", "name"],
    },
    async execute(_id: string, params: { target: string; file: string; name: string }) {
      const w = getWs();
      if (!w || w.readyState !== WebSocket.OPEN) {
        return { content: [{ type: "text", text: "OneBot 未连接" }] };
      }
      const t = params.target.replace(/^onebot:/i, "");
      try {
        if (t.startsWith("group:")) {
          await uploadGroupFile(parseInt(t.slice(6), 10), params.file, params.name);
        } else {
          await uploadPrivateFile(parseInt(t.replace(/^user:/, ""), 10), params.file, params.name);
        }
        return { content: [{ type: "text", text: "文件上传成功" }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `上传失败: ${e?.message}` }] };
      }
    },
  });

  api.registerTool({
    name: "onebot_get_group_msg_history",
    description: "获取群聊历史消息（需 Lagrange.Core，go-cqhttp 可能不支持）。用于定时总结、日报等场景",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "number", description: "群号" },
        count: { type: "number", description: "获取条数，默认 50" },
        message_seq: { type: "number", description: "可选，起始消息序号" },
        message_id: { type: "number", description: "可选，起始消息 ID" },
      },
      required: ["group_id"],
    },
    async execute(_id: string, params: { group_id: number; count?: number; message_seq?: number; message_id?: number }) {
      const w = getWs();
      if (!w || w.readyState !== WebSocket.OPEN) {
        return { content: [{ type: "text", text: "OneBot 未连接" }] };
      }
      try {
        const msgs = await getGroupMsgHistory(params.group_id, {
          count: params.count ?? 50,
          message_seq: params.message_seq,
          message_id: params.message_id,
        });
        const summary = msgs.map((m) => {
          const text = typeof m.message === "string" ? m.message : JSON.stringify(m.message);
          const nick = m.sender?.nickname ?? m.sender?.user_id ?? "?";
          return `[${new Date(m.time * 1000).toISOString()}] ${nick}: ${text.slice(0, 200)}`;
        });
        return { content: [{ type: "text", text: summary.join("\n") || "无历史消息" }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `获取失败: ${e?.message}` }] };
      }
    },
  });

  api.registerTool({
    name: "onebot_run_script",
    description: "执行用户配置的 JS/TS 脚本（.mjs/.ts/.mts），脚本可调用 OneBot API（获取群历史、发图等）。用于定时任务中实现自定义逻辑（如 OG 图片生成、日报汇总）",
    parameters: {
      type: "object",
      properties: {
        scriptPath: { type: "string", description: "脚本路径，相对 process.cwd() 或绝对路径，支持 .mjs/.ts/.mts，如 ./daily-summary.mjs 或 ./daily-summary.ts" },
        groupIds: { type: "array", items: { type: "number" }, description: "要处理的群号列表" },
      },
      required: ["scriptPath"],
    },
    async execute(_id: string, params: { scriptPath: string; groupIds?: number[] }) {
      const w = getWs();
      if (!w || w.readyState !== WebSocket.OPEN) {
        return { content: [{ type: "text", text: "OneBot 未连接" }] };
      }
      try {
        const mod = await loadScript(params.scriptPath);
        const fn = mod?.default ?? mod?.run ?? mod?.execute;
        if (typeof fn !== "function") {
          return { content: [{ type: "text", text: `脚本未导出 default/run/execute 函数` }] };
        }
        const ctx = {
          onebot: onebotClient,
          groupIds: params.groupIds ?? [],
        };
        const result = await fn(ctx);
        const out = result != null ? String(result) : "执行完成";
        return { content: [{ type: "text", text: out }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `脚本执行失败: ${e?.message}` }] };
      }
    },
  });
}
