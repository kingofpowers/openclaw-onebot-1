/**
 * 入站消息处理
 */
import { getOneBotConfig } from "../config.js";
import { getRawText, getTextFromSegments, getReplyMessageId, getTextFromMessageContent, isMentioned, } from "../message.js";
import { getRenderMarkdownToPlain, getCollapseDoubleNewlines, getWhitelistUserIds } from "../config.js";
import { markdownToPlain, collapseDoubleNewlines } from "../markdown.js";
import { markdownToImage } from "../og-image.js";
import { sendPrivateMsg, sendGroupMsg, sendPrivateImage, sendGroupImage, sendGroupForwardMsg, sendPrivateForwardMsg, setMsgEmojiLike, getMsg, getGroupMsgHistory, } from "../connection.js";
import { setActiveReplyTarget, clearActiveReplyTarget, setActiveReplySessionId, setForwardSuppressDelivery, setActiveReplySelfId } from "../reply-context.js";
import { loadPluginSdk, getSdk } from "../sdk.js";
import { handleGroupIncrease } from "./group-increase.js";
const DEFAULT_HISTORY_LIMIT = 20;
export const sessionHistories = new Map();
/** 追踪每个群最后一次机器人回复的消息 ID，用于获取历史消息时定位起点 */
const lastBotReplyMsgId = new Map();
/** forward 模式下待处理的会话，用于定期清理未完成的缓冲 */
const forwardPendingSessions = new Map();
/** 每个 replySessionId 已发送的 chunk 数量，用于支持多次 final（如工具调用后追加内容） */
const lastSentChunkCountBySession = new Map();
const FORWARD_PENDING_TTL_MS = 5 * 60 * 1000; // 5 分钟
const FORWARD_CLEANUP_INTERVAL_MS = 60 * 1000; // 每分钟清理一次
function cleanupForwardPendingSessions() {
    const now = Date.now();
    const toDelete = [];
    for (const [id, ts] of forwardPendingSessions) {
        if (now - ts > FORWARD_PENDING_TTL_MS)
            toDelete.push(id);
    }
    for (const id of toDelete)
        forwardPendingSessions.delete(id);
}
let forwardCleanupTimer = null;
export function startForwardCleanupTimer() {
    if (forwardCleanupTimer)
        return;
    forwardCleanupTimer = setInterval(cleanupForwardPendingSessions, FORWARD_CLEANUP_INTERVAL_MS);
}
export async function processInboundMessage(api, msg) {
    await loadPluginSdk();
    const { buildPendingHistoryContextFromMap, recordPendingHistoryEntry, clearHistoryEntriesIfEnabled } = getSdk();
    const runtime = api.runtime;
    if (!runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
        api.logger?.warn?.("[onebot] runtime.channel.reply not available");
        return;
    }
    const config = getOneBotConfig(api);
    if (!config) {
        api.logger?.warn?.("[onebot] not configured");
        return;
    }
    const selfId = msg.self_id ?? 0;
    if (msg.user_id != null && Number(msg.user_id) === Number(selfId)) {
        return;
    }
    const replyId = getReplyMessageId(msg);
    let messageText;
    if (replyId != null) {
        const userText = getTextFromSegments(msg);
        try {
            const quoted = await getMsg(replyId);
            const quotedText = quoted ? getTextFromMessageContent(quoted.message) : "";
            const senderLabel = quoted?.sender?.nickname ?? quoted?.sender?.user_id ?? "某人";
            messageText = quotedText.trim()
                ? `[引用 ${String(senderLabel)} 的消息：${quotedText.trim()}]\n${userText}`
                : userText;
        }
        catch {
            messageText = userText;
        }
    }
    else {
        messageText = getRawText(msg);
    }
    if (!messageText?.trim()) {
        api.logger?.info?.(`[onebot] ignoring empty message`);
        return;
    }
    const isGroup = msg.message_type === "group";
    const cfg = api.config;
    const requireMention = cfg?.channels?.onebot?.requireMention ?? true;
    if (isGroup && requireMention && !isMentioned(msg, selfId)) {
        api.logger?.info?.(`[onebot] ignoring group message without @mention`);
        return;
    }
    const gi = cfg?.channels?.onebot?.groupIncrease;
    // 测试欢迎：@ 机器人并发送 /group-increase，模拟当前发送者入群，触发欢迎（使用该人的 id、nickname 等）
    // 使用 getTextFromSegments 提取纯文本，避免 raw_message 中 [CQ:at,qq=xxx] 等 CQ 码导致匹配失败
    const cmdText = getTextFromSegments(msg).trim() || messageText.trim();
    const groupIncreaseTrigger = isGroup && isMentioned(msg, selfId) && /^\/group-increase\s*$/i.test(cmdText) && gi?.enabled;
    if (groupIncreaseTrigger) {
        const fakeMsg = {
            post_type: "notice",
            notice_type: "group_increase",
            group_id: msg.group_id,
            user_id: msg.user_id,
        };
        await handleGroupIncrease(api, fakeMsg);
        return;
    }
    const userId = msg.user_id;
    const whitelist = getWhitelistUserIds(cfg);
    if (whitelist.length > 0 && !whitelist.includes(Number(userId))) {
        const denyMsg = "权限不足，请向管理员申请权限";
        const getConfig = () => getOneBotConfig(api);
        try {
            if (msg.message_type === "group" && msg.group_id)
                await sendGroupMsg(msg.group_id, denyMsg, getConfig);
            else
                await sendPrivateMsg(userId, denyMsg, getConfig);
        }
        catch (_) { }
        api.logger?.info?.(`[onebot] user ${userId} not in whitelist, denied`);
        return;
    }
    const groupId = msg.group_id;
    const sessionId = isGroup
        ? `onebot:group:${groupId}`.toLowerCase()
        : `onebot:${userId}`.toLowerCase();
    const route = runtime.channel.routing?.resolveAgentRoute?.({
        cfg,
        sessionKey: sessionId,
        channel: "onebot",
        accountId: config.accountId ?? "default",
    }) ?? { agentId: "main" };
    const storePath = runtime.channel.session?.resolveStorePath?.(cfg?.session?.store, {
        agentId: route.agentId,
    }) ?? "";
    const envelopeOptions = runtime.channel.reply?.resolveEnvelopeFormatOptions?.(cfg) ?? {};
    const chatType = isGroup ? "group" : "direct";
    const fromLabel = String(userId);
    const formattedBody = runtime.channel.reply?.formatInboundEnvelope?.({
        channel: "OneBot",
        from: fromLabel,
        timestamp: Date.now(),
        body: messageText,
        chatType,
        sender: { name: fromLabel, id: String(userId) },
        envelope: envelopeOptions,
    }) ?? { content: [{ type: "text", text: messageText }] };
    // 群聊被 @ 时获取历史消息作为上下文
    const onebotCfg = cfg?.channels?.onebot ?? {};
    const groupHistoryOnMention = onebotCfg.groupHistoryOnMention ?? false;
    const groupHistoryLimit = onebotCfg.groupHistoryLimit ?? 50;
    let historyContext = [];
    if (isGroup && isMentioned(msg, selfId) && groupHistoryOnMention && groupId) {
        try {
            const history = await getGroupMsgHistory(Number(groupId), {
                count: groupHistoryLimit,
            });
            if (history && history.length > 0) {
                // 过滤掉机器人自己的消息，格式化历史消息
                // getGroupMsgHistory 返回的是倒序的（最新在前），需要反转
                historyContext = history
                    .filter((m) => Number(m.user_id) !== Number(selfId))
                    .reverse() // 反转为正序（旧 -> 新）
                    .map((m) => {
                        const text = getTextFromMessageContent(m.message);
                        const senderId = String(m.user_id);
                        const senderName = m.sender?.nickname ?? m.sender?.card ?? senderId;
                        return { senderId, senderName, text, timestamp: m.time };
                    });
                api.logger?.info?.(`[onebot] fetched ${historyContext.length} history messages for group ${groupId}`);
            }
        }
        catch (e) {
            api.logger?.warn?.(`[onebot] failed to fetch group history: ${e?.message}`);
        }
    }
    const body = buildPendingHistoryContextFromMap
        ? buildPendingHistoryContextFromMap({
            historyMap: sessionHistories,
            historyKey: sessionId,
            limit: DEFAULT_HISTORY_LIMIT,
            currentMessage: formattedBody,
            formatEntry: (entry) => runtime.channel.reply?.formatInboundEnvelope?.({
                channel: "OneBot",
                from: fromLabel,
                timestamp: entry.timestamp,
                body: entry.body,
                chatType,
                senderLabel: entry.sender,
                envelope: envelopeOptions,
            }) ?? { content: [{ type: "text", text: entry.body }] },
        })
        : formattedBody;
    if (recordPendingHistoryEntry) {
        recordPendingHistoryEntry({
            historyMap: sessionHistories,
            historyKey: sessionId,
            entry: {
                sender: fromLabel,
                body: messageText,
                timestamp: Date.now(),
                messageId: `onebot-${Date.now()}`,
            },
            limit: DEFAULT_HISTORY_LIMIT,
        });
    }
    // 回复目标（参考 openclaw-feishu）：群聊用 group:群号，私聊用 user:用户号
    // To / OriginatingTo / ConversationLabel 均表示「发送目标」，Agent 的 message 工具会据此选择 target
    const replyTarget = isGroup ? `onebot:group:${groupId}` : `onebot:${userId}`;
    // 如果有历史消息，将其拼接到用户消息前面，确保 AI 能看到上下文
    let finalRawBody = messageText;
    if (historyContext.length > 0) {
        const historyText = historyContext
            .map((h) => `[${h.senderName}]: ${h.text}`)
            .join("\n");
        finalRawBody = `【群聊历史记录】\n${historyText}\n【以上是历史消息】\n\n用户消息: ${messageText}`;
        api.logger?.info?.(`[onebot] history context prepended, total ${finalRawBody.length} chars`);
    }
    const ctxPayload = {
        Body: body,
        RawBody: finalRawBody,
        From: isGroup ? `onebot:group:${groupId}` : `onebot:${userId}`,
        To: replyTarget,
        SessionKey: sessionId,
        AccountId: config.accountId ?? "default",
        ChatType: chatType,
        ConversationLabel: replyTarget, // 与 Feishu 一致：表示会话/回复目标，群聊时为 group:群号，非 SenderId
        SenderName: fromLabel,
        SenderId: String(userId),
        Provider: "onebot",
        Surface: "onebot",
        MessageSid: `onebot-${Date.now()}`,
        Timestamp: Date.now(),
        OriginatingChannel: "onebot",
        OriginatingTo: replyTarget,
        CommandAuthorized: true,
        DeliveryContext: {
            channel: "onebot",
            to: replyTarget,
            accountId: config.accountId ?? "default",
        },
        _onebot: { userId, groupId, isGroup },
    };
    if (runtime.channel.session?.recordInboundSession) {
        await runtime.channel.session.recordInboundSession({
            storePath,
            sessionKey: sessionId,
            ctx: ctxPayload,
            updateLastRoute: !isGroup ? { sessionKey: sessionId, channel: "onebot", to: String(userId), accountId: config.accountId ?? "default" } : undefined,
            onRecordError: (err) => api.logger?.warn?.(`[onebot] recordInboundSession: ${err}`),
        });
    }
    if (runtime.channel.activity?.record) {
        runtime.channel.activity.record({ channel: "onebot", accountId: config.accountId ?? "default", direction: "inbound" });
    }
    const thinkingEmojiId = onebotCfg.thinkingEmojiId ?? 60;
    const userMessageId = msg.message_id;
    let emojiAdded = false;
    const clearEmojiReaction = async () => {
        if (emojiAdded && userMessageId != null) {
            try {
                await setMsgEmojiLike(userMessageId, thinkingEmojiId, false);
            }
            catch { }
            emojiAdded = false;
        }
    };
    if (userMessageId != null) {
        try {
            await setMsgEmojiLike(userMessageId, thinkingEmojiId, true);
            emojiAdded = true;
        }
        catch {
            api.logger?.warn?.("[onebot] setMsgEmojiLike failed (maybe OneBot doesn't support it)");
        }
    }
    api.logger?.info?.(`[onebot] dispatching message for session ${sessionId}`);
    const longMessageMode = onebotCfg.longMessageMode ?? "normal";
    const longMessageThreshold = onebotCfg.longMessageThreshold ?? 300;
    const replySessionId = `onebot-reply-${Date.now()}-${sessionId}`;
    setActiveReplyTarget(replyTarget);
    setActiveReplySessionId(replySessionId);
    setActiveReplySelfId(selfId);
    if (longMessageMode === "forward")
        setForwardSuppressDelivery(true);
    const deliveredChunks = [];
    let chunkIndex = 0;
    const getConfig = () => getOneBotConfig(api);
    const onReplySessionEnd = onebotCfg.onReplySessionEnd;
    const doSendChunk = async (effectiveIsGroup, effectiveGroupId, uid, text, mediaUrl) => {
        let lastMsgId = undefined;
        if (text) {
            if (effectiveIsGroup && effectiveGroupId) {
                lastMsgId = await sendGroupMsg(effectiveGroupId, text, getConfig);
                // 记录机器人最后发送的消息 ID，用于下次获取历史消息时定位起点
                if (lastMsgId != null) {
                    lastBotReplyMsgId.set(effectiveGroupId, lastMsgId);
                }
            }
            else if (uid)
                lastMsgId = await sendPrivateMsg(uid, text, getConfig);
        }
        if (mediaUrl) {
            if (effectiveIsGroup && effectiveGroupId) {
                lastMsgId = await sendGroupImage(effectiveGroupId, mediaUrl, api.logger, getConfig);
                if (lastMsgId != null) {
                    lastBotReplyMsgId.set(effectiveGroupId, lastMsgId);
                }
            }
            else if (uid)
                lastMsgId = await sendPrivateImage(uid, mediaUrl, api.logger, getConfig);
        }
        return lastMsgId;
    };
    try {
        await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
                deliver: async (payload, info) => {
                    await clearEmojiReaction();
                    const p = payload;
                    const replyText = typeof p === "string" ? p : (p?.text ?? p?.body ?? "");
                    const mediaUrl = typeof p === "string" ? undefined : (p?.mediaUrl ?? p?.mediaUrls?.[0]);
                    const trimmed = (replyText || "").trim();
                    if ((!trimmed || trimmed === "NO_REPLY" || trimmed.endsWith("NO_REPLY")) && !mediaUrl)
                        return;
                    const { userId: uid, groupId: gid, isGroup: ig } = ctxPayload._onebot || {};
                    const sessionKey = String(ctxPayload.SessionKey ?? sessionId);
                    const groupMatch = sessionKey.match(/^onebot:group:(\d+)$/i);
                    const effectiveIsGroup = groupMatch != null || Boolean(ig);
                    const effectiveGroupId = (groupMatch ? parseInt(groupMatch[1], 10) : undefined) ?? gid;
                    const usePlain = getRenderMarkdownToPlain(cfg);
                    let textPlain = usePlain ? markdownToPlain(trimmed) : trimmed;
                    if (getCollapseDoubleNewlines(cfg))
                        textPlain = collapseDoubleNewlines(textPlain);
                    deliveredChunks.push({
                        index: chunkIndex++,
                        text: textPlain || undefined,
                        rawText: trimmed || undefined,
                        mediaUrl: mediaUrl || undefined,
                    });
                    const shouldSendNow = longMessageMode === "normal";
                    // forward 模式且非最后一条：仅暂存，绝不发送，等 final 时再统一处理
                    if (longMessageMode === "forward" && info.kind !== "final") {
                        forwardPendingSessions.set(replySessionId, Date.now());
                        return;
                    }
                    if (info.kind === "final" && longMessageMode === "forward") {
                        forwardPendingSessions.delete(replySessionId);
                    }
                    try {
                        if (shouldSendNow) {
                            await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, textPlain, mediaUrl);
                        }
                        if (info.kind === "final") {
                            // 如果 shouldSendNow 为 true，消息已经在上面的 if 里发送了，不需要再处理
                            if (shouldSendNow) {
                                lastSentChunkCountBySession.set(replySessionId, deliveredChunks.length);
                                return;
                            }
                            const lastSentCount = lastSentChunkCountBySession.get(replySessionId) ?? 0;
                            const chunksToSend = deliveredChunks.slice(lastSentCount);
                            if (chunksToSend.length === 0)
                                return;
                            const totalLen = deliveredChunks.reduce((s, c) => s + (c.rawText ?? c.text ?? "").length, 0);
                            const isLong = totalLen > longMessageThreshold;
                            const isIncremental = lastSentCount > 0;
                            if (isIncremental) {
                                setForwardSuppressDelivery(false);
                                for (const c of chunksToSend) {
                                    if (c.text || c.mediaUrl)
                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                }
                            }
                            else if (!shouldSendNow && (longMessageMode === "og_image" || longMessageMode === "forward")) {
                                if (isLong && longMessageMode === "og_image") {
                                    const fullRaw = deliveredChunks.map((c) => c.rawText ?? c.text ?? "").join("\n\n");
                                    if (fullRaw.trim()) {
                                        try {
                                            const imgUrl = await markdownToImage(fullRaw);
                                            if (imgUrl) {
                                                if (effectiveIsGroup && effectiveGroupId)
                                                    await sendGroupImage(effectiveGroupId, imgUrl, api.logger, getConfig);
                                                else if (uid)
                                                    await sendPrivateImage(uid, imgUrl, api.logger, getConfig);
                                            }
                                            else {
                                                api.logger?.warn?.("[onebot] og_image: node-html-to-image not installed, falling back to normal send");
                                                setForwardSuppressDelivery(false);
                                                for (const c of deliveredChunks) {
                                                    if (c.text || c.mediaUrl)
                                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                                }
                                            }
                                        }
                                        catch (e) {
                                            api.logger?.error?.(`[onebot] og_image failed: ${e?.message}`);
                                            setForwardSuppressDelivery(false);
                                            for (const c of deliveredChunks) {
                                                if (c.text || c.mediaUrl)
                                                    await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                            }
                                        }
                                    }
                                }
                                else if (isLong && longMessageMode === "forward") {
                                    try {
                                        const nodes = [];
                                        for (const c of deliveredChunks) {
                                            if (c.mediaUrl) {
                                                const mid = await sendPrivateImage(selfId, c.mediaUrl, api.logger, getConfig);
                                                if (mid)
                                                    nodes.push({ type: "node", data: { id: String(mid) } });
                                            }
                                            else if (c.text) {
                                                const mid = await sendPrivateMsg(selfId, c.text, getConfig);
                                                if (mid)
                                                    nodes.push({ type: "node", data: { id: String(mid) } });
                                            }
                                        }
                                        if (nodes.length > 0) {
                                            if (effectiveIsGroup && effectiveGroupId)
                                                await sendGroupForwardMsg(effectiveGroupId, nodes, getConfig);
                                            else if (uid)
                                                await sendPrivateForwardMsg(uid, nodes, getConfig);
                                        }
                                    }
                                    catch (e) {
                                        api.logger?.error?.(`[onebot] forward failed: ${e?.message}`);
                                        setForwardSuppressDelivery(false);
                                        for (const c of deliveredChunks) {
                                            if (c.text || c.mediaUrl)
                                                await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                        }
                                    }
                                }
                                else {
                                    setForwardSuppressDelivery(false);
                                    for (const c of deliveredChunks) {
                                        if (c.text || c.mediaUrl)
                                            await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                    }
                                }
                            }
                            lastSentChunkCountBySession.set(replySessionId, deliveredChunks.length);
                            if (clearHistoryEntriesIfEnabled) {
                                clearHistoryEntriesIfEnabled({
                                    historyMap: sessionHistories,
                                    historyKey: sessionId,
                                    limit: DEFAULT_HISTORY_LIMIT,
                                });
                            }
                            if (onReplySessionEnd) {
                                const ctx = {
                                    replySessionId,
                                    sessionId,
                                    to: replyTarget,
                                    chunks: deliveredChunks.map(({ index, text: t, mediaUrl: m }) => ({ index, text: t, mediaUrl: m })),
                                    userMessage: messageText,
                                };
                                if (typeof onReplySessionEnd === "function") {
                                    await onReplySessionEnd(ctx);
                                }
                                else if (typeof onReplySessionEnd === "string" && onReplySessionEnd.trim()) {
                                    const { loadScript } = await import("../load-script.js");
                                    const mod = await loadScript(onReplySessionEnd.trim());
                                    const fn = mod?.default ?? mod?.onReplySessionEnd;
                                    if (typeof fn === "function")
                                        await fn(ctx);
                                }
                            }
                        }
                    }
                    catch (e) {
                        api.logger?.error?.(`[onebot] deliver failed: ${e?.message}`);
                    }
                },
                onError: async (err, info) => {
                    api.logger?.error?.(`[onebot] ${info?.kind} reply failed: ${err}`);
                    await clearEmojiReaction();
                },
            },
            replyOptions: { disableBlockStreaming: true },
        });
    }
    catch (err) {
        await clearEmojiReaction();
        api.logger?.error?.(`[onebot] dispatch failed: ${err?.message}`);
        try {
            const { userId: uid, groupId: gid, isGroup: ig } = ctxPayload._onebot || {};
            if (ig && gid)
                await sendGroupMsg(gid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
            else if (uid)
                await sendPrivateMsg(uid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
        }
        catch (_) { }
    }
    finally {
        setForwardSuppressDelivery(false);
        setActiveReplySelfId(null);
        lastSentChunkCountBySession.delete(replySessionId);
        forwardPendingSessions.delete(replySessionId);
        setActiveReplySessionId(null);
        clearActiveReplyTarget();
    }
}
