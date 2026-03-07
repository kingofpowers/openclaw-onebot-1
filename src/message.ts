/**
 * OneBot 消息解析
 */

import type { OneBotMessage } from "./types.js";

/** 从消息段数组中提取引用/回复的消息 ID（OneBot reply 段） */
export function getReplyMessageId(msg: OneBotMessage): number | undefined {
  if (!msg?.message || !Array.isArray(msg.message)) return undefined;
  const replySeg = msg.message.find((m) => m?.type === "reply");
  if (!replySeg?.data) return undefined;
  const id = (replySeg.data as Record<string, unknown>)?.id;
  if (id == null) return undefined;
  const num = typeof id === "number" ? id : parseInt(String(id), 10);
  return Number.isNaN(num) ? undefined : num;
}

/** 从 get_msg 返回的 message 字段中提取文本和图片链接（供 AI 理解引用内容） */
export function getTextFromMessageContent(content: string | unknown[] | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const m of content) {
    const seg = m as { type?: string; data?: Record<string, unknown> };
    if (seg?.type === "text") {
      const t = (seg.data?.text as string) ?? "";
      if (t) parts.push(t);
    } else if (seg?.type === "image") {
      const url = (seg.data?.url as string) ?? (seg.data?.file as string) ?? "";
      parts.push(url ? `[图片: ${url}]` : "[图片]");
    }
  }
  return parts.join("");
}

/** 仅从 message 段数组提取 text 段（不含 raw_message，用于有引用时避免 CQ 码） */
export function getTextFromSegments(msg: OneBotMessage): string {
  const arr = msg?.message;
  if (!Array.isArray(arr)) return "";
  return arr
    .filter((m) => m?.type === "text")
    .map((m) => (m?.data as Record<string, unknown>)?.text ?? "")
    .join("");
}

export function getRawText(msg: OneBotMessage): string {
  if (!msg) return "";
  if (typeof msg.raw_message === "string" && msg.raw_message) {
    return msg.raw_message;
  }
  return getTextFromSegments(msg);
}

export function isMentioned(msg: OneBotMessage, selfId: number): boolean {
  const arr = msg.message;
  if (!Array.isArray(arr)) return false;
  const selfStr = String(selfId);
  return arr.some((m) => m?.type === "at" && String((m?.data as any)?.qq || (m?.data as any)?.id) === selfStr);
}
