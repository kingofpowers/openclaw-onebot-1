/**
 * OneBot 消息解析
 */
/** 从消息段数组中提取引用/回复的消息 ID（OneBot reply 段） */
export function getReplyMessageId(msg) {
    if (!msg?.message || !Array.isArray(msg.message))
        return undefined;
    const replySeg = msg.message.find((m) => m?.type === "reply");
    if (!replySeg?.data)
        return undefined;
    const id = replySeg.data?.id;
    if (id == null)
        return undefined;
    const num = typeof id === "number" ? id : parseInt(String(id), 10);
    return Number.isNaN(num) ? undefined : num;
}
/** 从 get_msg 返回的 message 字段中提取文本和图片链接（供 AI 理解引用内容） */
export function getTextFromMessageContent(content) {
    if (!content)
        return "";
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    const parts = [];
    for (const m of content) {
        const seg = m;
        if (seg?.type === "text") {
            const t = seg.data?.text ?? "";
            if (t)
                parts.push(t);
        }
        else if (seg?.type === "image") {
            const url = seg.data?.url ?? seg.data?.file ?? "";
            parts.push(url ? `[图片: ${url}]` : "[图片]");
        }
    }
    return parts.join("");
}
/** 仅从 message 段数组提取 text 段（不含 raw_message，用于有引用时避免 CQ 码） */
export function getTextFromSegments(msg) {
    const arr = msg?.message;
    if (!Array.isArray(arr))
        return "";
    return arr
        .filter((m) => m?.type === "text")
        .map((m) => m?.data?.text ?? "")
        .join("");
}
export function getRawText(msg) {
    if (!msg)
        return "";
    if (typeof msg.raw_message === "string" && msg.raw_message) {
        return msg.raw_message;
    }
    return getTextFromSegments(msg);
}
export function isMentioned(msg, selfId) {
    const arr = msg.message;
    if (!Array.isArray(arr))
        return false;
    const selfStr = String(selfId);
    return arr.some((m) => m?.type === "at" && String(m?.data?.qq || m?.data?.id) === selfStr);
}
