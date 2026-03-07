/**
 * OneBot WebSocket 连接与 API 调用
 *
 * 图片消息：网络 URL 会先下载到本地再发送（兼容 Lagrange.Core retcode 1200），
 * 并定期清理临时文件。
 */
import WebSocket from "ws";
import { createServer } from "http";
import https from "https";
import http from "http";
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { logSend } from "./send-debug-log.js";
import { shouldBlockSendInForwardMode, getActiveReplyTarget, getActiveReplySessionId } from "./reply-context.js";
const IMAGE_TEMP_DIR = join(tmpdir(), "openclaw-onebot");
const DOWNLOAD_TIMEOUT_MS = 30000;
/** 使用 Node 内置 http(s) 下载 URL，避免 fetch 在某些环境下的兼容性问题 */
function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            const redirect = res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location;
            if (redirect) {
                downloadUrl(redirect.startsWith("http") ? redirect : new URL(redirect, url).href).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error("Download timeout"));
        });
    });
}
const IMAGE_TEMP_MAX_AGE_MS = 60 * 60 * 1000; // 1 小时
const IMAGE_TEMP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 每小时清理一次
let imageTempCleanupTimer = null;
/** 清理过期的临时图片文件 */
function cleanupImageTemp() {
    try {
        if (!readdirSync)
            return;
        const files = readdirSync(IMAGE_TEMP_DIR);
        const now = Date.now();
        for (const f of files) {
            const p = join(IMAGE_TEMP_DIR, f);
            try {
                const st = statSync(p);
                if (st.isFile() && now - st.mtimeMs > IMAGE_TEMP_MAX_AGE_MS) {
                    unlinkSync(p);
                }
            }
            catch {
                /* ignore */
            }
        }
    }
    catch {
        /* dir not exist or readdir failed */
    }
}
/** 将 mediaUrl 解析为可发送的格式。网络 URL 下载后转 base64，本地文件读取后转 base64，兼容跨容器发送 */
async function resolveImageToLocalPath(image) {
    const trimmed = image?.trim();
    if (!trimmed)
        throw new Error("Empty image");
    const fs = await import("fs");
    // 网络 URL：下载后转 base64
    if (/^https?:\/\//i.test(trimmed)) {
        cleanupImageTemp();
        const buf = await downloadUrl(trimmed);
        const ext = (trimmed.match(/\.(png|jpg|jpeg|gif|webp|bmp)(?:\?|$)/i)?.[1] ?? "png").toLowerCase();
        const b64 = buf.toString("base64");
        return `base64://${b64}`;
    }
    // base64:// 直接返回
    if (trimmed.startsWith("base64://")) {
        return trimmed;
    }
    // file:// 或本地路径：读取后转 base64（兼容跨容器）
    let filePath = trimmed;
    if (trimmed.startsWith("file://")) {
        filePath = trimmed.slice(7);
    }
    try {
        const buf = fs.readFileSync(filePath);
        const b64 = buf.toString("base64");
        return `base64://${b64}`;
    }
    catch (e) {
        throw new Error(`Failed to read image file: ${filePath}`);
    }
}
/** 启动临时图片定期清理（每小时执行一次） */
export function startImageTempCleanup() {
    stopImageTempCleanup();
    imageTempCleanupTimer = setInterval(cleanupImageTemp, IMAGE_TEMP_CLEANUP_INTERVAL_MS);
}
/** 停止临时图片定期清理 */
export function stopImageTempCleanup() {
    if (imageTempCleanupTimer) {
        clearInterval(imageTempCleanupTimer);
        imageTempCleanupTimer = null;
    }
}
// 多账号支持：accountId -> WebSocket
const wsMap = new Map();
let wsServer = null;
let httpServer = null;
const pendingEcho = new Map();
let echoCounter = 0;
const connectionReadyResolves = new Map();
const connectionReadyPromises = new Map();

function nextEcho() {
    return `onebot-${Date.now()}-${++echoCounter}`;
}
export function handleEchoResponse(payload) {
    if (payload?.echo && pendingEcho.has(payload.echo)) {
        const h = pendingEcho.get(payload.echo);
        h?.resolve(payload);
        return true;
    }
    return false;
}
function getLogger() {
    return globalThis.__onebotApi?.logger ?? {};
}
// 获取指定账号的 WebSocket 连接
export function getWs(accountId = "default") {
    return wsMap.get(accountId);
}
// 添加 WebSocket 连接
export function addWs(accountId, ws) {
    wsMap.set(accountId, ws);
    const resolve = connectionReadyResolves.get(accountId);
    if (resolve) resolve();
}
// 移除 WebSocket 连接
export function removeWs(accountId) {
    wsMap.delete(accountId);
    connectionReadyResolves.delete(accountId);
    connectionReadyPromises.delete(accountId);
}
// 获取所有已连接的账号
export function getConnectedAccountIds() {
    return Array.from(wsMap.keys());
}
async function sendOneBotAction(wsocket, action, params, log = getLogger()) {
    const echo = nextEcho();
    const payload = { action, params, echo };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingEcho.delete(echo);
            log.warn?.(`[onebot] sendOneBotAction ${action} timeout`);
            reject(new Error(`OneBot action ${action} timeout`));
        }, 15000);
        pendingEcho.set(echo, {
            resolve: (v) => {
                clearTimeout(timeout);
                pendingEcho.delete(echo);
                if (v?.retcode !== 0)
                    log.warn?.(`[onebot] sendOneBotAction ${action} retcode=${v?.retcode} msg=${v?.msg ?? ""}`);
                resolve(v);
            },
        });
        wsocket.send(JSON.stringify(payload), (err) => {
            if (err) {
                pendingEcho.delete(echo);
                clearTimeout(timeout);
                reject(err);
            }
        });
    });
}
/** 为 WebSocket 设置 echo 响应处理（按需连接时需调用，以便 sendOneBotAction 能收到响应） */
function setupEchoHandler(socket) {
    socket.on("message", (data) => {
        try {
            const payload = JSON.parse(data.toString());
            handleEchoResponse(payload);
        }
        catch {
            /* ignore */
        }
    });
}
/** 等待 WebSocket 连接就绪（service 启动后异步建立连接，发送前需先等待） */
export async function waitForConnection(accountId = "default", timeoutMs = 30000) {
    const ws = wsMap.get(accountId);
    if (ws && ws.readyState === WebSocket.OPEN)
        return ws;
    const log = getLogger();
    log.info?.(`[onebot] waitForConnection: waiting for WebSocket (accountId=${accountId})...`);
    // 确保有 promise
    if (!connectionReadyPromises.has(accountId)) {
        connectionReadyPromises.set(accountId, new Promise((r) => {
            connectionReadyResolves.set(accountId, r);
        }));
    }
    return Promise.race([
        connectionReadyPromises.get(accountId).then(() => {
            const w = wsMap.get(accountId);
            if (w && w.readyState === WebSocket.OPEN)
                return w;
            throw new Error("OneBot WebSocket not connected");
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`OneBot WebSocket (accountId=${accountId}) not connected after ${timeoutMs}ms. Ensure "openclaw gateway run" is running and OneBot (Lagrange.Core) is connected.`)), timeoutMs)),
    ]);
}
/**
 * 确保有可用的 WebSocket 连接。当 service 未启动时，
 * forward-websocket 模式直接建立连接（message send 可独立运行）；
 * backward-websocket 模式需等待 gateway 的 service 建立连接。
 */
export async function ensureConnection(getConfig, accountId = "default", timeoutMs = 30000) {
    const ws = wsMap.get(accountId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        return ws;
    }
    const config = getConfig();
    if (!config)
        throw new Error(`OneBot not configured for accountId=${accountId}`);
    const log = getLogger();
    if (config.type === "forward-websocket") {
        log.info?.(`[onebot] 连接 OneBot (forward-websocket, accountId=${accountId})...`);
        const socket = await connectForward(config);
        setupEchoHandler(socket);
        addWs(accountId, socket);
        return socket;
    }
    return waitForConnection(accountId, timeoutMs);
}
export async function sendPrivateMsg(userId, text, getConfig, accountId = "default") {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateMsg", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateMsg", {
        targetType: "user",
        targetId: userId,
        textPreview: text?.slice(0, 80),
        textLen: text?.length,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig, accountId)
        : await waitForConnection(accountId);
    const res = await sendOneBotAction(socket, "send_private_msg", { user_id: userId, message: text });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    logSend("connection", "sendPrivateMsg", { targetId: userId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function sendGroupMsg(groupId, text, getConfig, accountId = "default") {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupMsg", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendGroupMsg", {
        targetType: "group",
        targetId: groupId,
        textPreview: text?.slice(0, 80),
        textLen: text?.length,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
        accountId,
    });
    const socket = getConfig
        ? await ensureConnection(getConfig, accountId)
        : await waitForConnection(accountId);
    const res = await sendOneBotAction(socket, "send_group_msg", { group_id: groupId, message: text });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_msg failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    logSend("connection", "sendGroupMsg", { targetId: groupId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function sendGroupImage(groupId, image, log = getLogger(), getConfig, accountId = "default") {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupImage", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendGroupImage", {
        targetType: "group",
        targetId: groupId,
        imagePreview: image?.slice?.(0, 60),
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    log.info?.(`[onebot] sendGroupImage entry: groupId=${groupId} image=${image?.slice?.(0, 80) ?? ""}`);
    const socket = getConfig ? await ensureConnection(getConfig, accountId) : await waitForConnection(accountId);
    log.info?.(`222[onebot] sendGroupImage entry: groupId=${groupId} image=${image?.slice?.(0, 80) ?? ""}`);
    try {
        const filePath = image.startsWith("[") ? null : await resolveImageToLocalPath(image);
        const seg = image.startsWith("[")
            ? JSON.parse(image)
            : [{ type: "image", data: { file: filePath } }];
        log.info?.(`333[onebot] sendGroupImage entry: groupId=${groupId} image=${image?.slice?.(0, 80) ?? ""}`);
        const res = await sendOneBotAction(socket, "send_group_msg", { group_id: groupId, message: seg }, log);
        if (res?.retcode !== 0) {
            throw new Error(res?.msg ?? `OneBot send_group_msg (image) failed (retcode=${res?.retcode})`);
        }
        log.info?.(`[onebot] sendGroupImage done: retcode=${res?.retcode ?? "?"}`);
        const mid = res?.data?.message_id;
        logSend("connection", "sendGroupImage", { targetId: groupId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return mid;
    }
    catch (error) {
        log.warn?.(`[onebot] sendGroupImage error: ${error}`);
    }
}
/** 发送群合并转发消息。messages 为节点数组，每节点 { type: "node", data: { id } } 或 { type: "node", data: { user_id, nickname, content } } */
export async function sendGroupForwardMsg(groupId, messages, getConfig, accountId = "default") {
    logSend("connection", "sendGroupForwardMsg", {
        targetType: "group",
        targetId: groupId,
        nodeCount: messages.length,
        isForward: true,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig, accountId) : await waitForConnection(accountId);
    const res = await sendOneBotAction(socket, "send_group_forward_msg", { group_id: groupId, messages });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_forward_msg failed (retcode=${res?.retcode})`);
    }
}
/** 发送私聊合并转发消息 */
export async function sendPrivateForwardMsg(userId, messages, getConfig, accountId = "default") {
    logSend("connection", "sendPrivateForwardMsg", {
        targetType: "user",
        targetId: userId,
        nodeCount: messages.length,
        isForward: true,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig, accountId) : await waitForConnection(accountId);
    const res = await sendOneBotAction(socket, "send_private_forward_msg", { user_id: userId, messages });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_forward_msg failed (retcode=${res?.retcode})`);
    }
}
export async function sendPrivateImage(userId, image, log = getLogger(), getConfig, accountId = "default") {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateImage", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateImage", {
        targetType: "user",
        targetId: userId,
        imagePreview: image?.slice?.(0, 60),
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    log.info?.(`[onebot] sendPrivateImage entry: userId=${userId} image=${image?.slice?.(0, 80) ?? ""}`);
    const socket = getConfig ? await ensureConnection(getConfig, accountId) : await waitForConnection(accountId);
    const filePath = image.startsWith("[") ? null : await resolveImageToLocalPath(image);
    const seg = image.startsWith("[")
        ? JSON.parse(image)
        : [{ type: "image", data: { file: filePath } }];
    const res = await sendOneBotAction(socket, "send_private_msg", { user_id: userId, message: seg }, log);
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg (image) failed (retcode=${res?.retcode})`);
    }
    log.info?.(`[onebot] sendPrivateImage done: retcode=${res?.retcode ?? "?"}`);
    const mid = res?.data?.message_id;
    logSend("connection", "sendPrivateImage", { targetId: userId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function uploadGroupFile(groupId, file, name, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    await sendOneBotAction(ws, "upload_group_file", { group_id: groupId, file, name });
}
export async function uploadPrivateFile(userId, file, name, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    await sendOneBotAction(ws, "upload_private_file", { user_id: userId, file, name });
}
/** 撤回消息 */
export async function deleteMsg(messageId, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    await sendOneBotAction(ws, "delete_msg", { message_id: messageId });
}
/**
 * 对消息进行表情回应（Lagrange/QQ NT 扩展 API）
 * @param message_id 需要回应的消息 ID（用户发送的消息）
 * @param emoji_id 表情 ID，1 通常为点赞
 * @param is_set true 添加，false 取消
 */
export async function setMsgEmojiLike(message_id, emoji_id, is_set = true, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    await sendOneBotAction(ws, "set_msg_emoji_like", { message_id, emoji_id, is_set });
}
/** 获取陌生人信息（含 nickname） */
export async function getStrangerInfo(userId, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_stranger_info", { user_id: userId, no_cache: false });
        if (res?.retcode === 0 && res?.data)
            return { nickname: String(res.data.nickname ?? "") };
        return null;
    }
    catch {
        return null;
    }
}
/** 获取群成员信息（含 nickname、card） */
export async function getGroupMemberInfo(groupId, userId, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_group_member_info", { group_id: groupId, user_id: userId, no_cache: false });
        if (res?.retcode === 0 && res?.data) {
            return { nickname: String(res.data.nickname ?? ""), card: String(res.data.card ?? "") };
        }
        return null;
    }
    catch {
        return null;
    }
}
/** 获取群信息（含 group_name） */
export async function getGroupInfo(groupId, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_group_info", { group_id: groupId, no_cache: false });
        if (res?.retcode === 0 && res?.data)
            return { group_name: String(res.data.group_name ?? "") };
        return null;
    }
    catch {
        return null;
    }
}
/** QQ 头像 URL，s=640 为常用尺寸 */
export function getAvatarUrl(userId, size = 640) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=${size}`;
}
/** 获取单条消息（需 OneBot 实现支持） */
export async function getMsg(messageId, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_msg", { message_id: messageId });
        if (res?.retcode === 0 && res?.data)
            return res.data;
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 获取群聊历史消息（Lagrange.Core 扩展 API，go-cqhttp 等可能不支持）
 * @param groupId 群号
 * @param opts message_seq 起始序号；message_id 起始消息 ID；count 数量
 */
export async function getGroupMsgHistory(groupId, opts = { count: 20 }, accountId = "default") {
    const ws = wsMap.get(accountId);
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return [];
    try {
        const res = await sendOneBotAction(ws, "get_group_msg_history", {
            group_id: groupId,
            message_seq: opts.message_seq,
            message_id: opts.message_id,
            count: opts.count ?? 20,
        });
        if (res?.retcode === 0 && res?.data?.messages)
            return res.data.messages;
        return [];
    }
    catch {
        return [];
    }
}
export async function connectForward(config) {
    const path = config.path ?? "/onebot/v11/ws";
    const pathNorm = path.startsWith("/") ? path : `/${path}`;
    const addr = `ws://${config.host}:${config.port}${pathNorm}`;
    const headers = {};
    if (config.accessToken) {
        headers["Authorization"] = `Bearer ${config.accessToken}`;
    }
    const w = new WebSocket(addr, { headers });
    await new Promise((resolve, reject) => {
        w.on("open", () => resolve());
        w.on("error", reject);
    });
    return w;
}
export async function createServerAndWait(config) {
    const { WebSocketServer } = await import("ws");
    const server = createServer();
    httpServer = server;
    const wss = new WebSocketServer({
        server,
        path: config.path ?? "/onebot/v11/ws",
    });
    const host = config.host || "0.0.0.0";
    server.listen(config.port, host);
    wsServer = wss;
    return new Promise((resolve) => {
        wss.on("connection", (socket) => {
            resolve(socket);
        });
    });
}
/** @deprecated 使用 addWs(accountId, ws) 代替 */
export function setWs(socket, accountId = "default") {
    addWs(accountId, socket);
}
export function stopConnection() {
    // 关闭所有 WebSocket 连接
    for (const [accountId, ws] of wsMap) {
        try {
            ws.close();
        }
        catch { }
    }
    wsMap.clear();
    connectionReadyResolves.clear();
    connectionReadyPromises.clear();
    if (wsServer) {
        wsServer.close();
        wsServer = null;
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
}
