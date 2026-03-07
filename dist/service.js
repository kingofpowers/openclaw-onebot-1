/**
 * OneBot WebSocket 服务（多账号支持）
 */
import { getOneBotConfig, listAccountIds } from "./config.js";
import { connectForward, createServerAndWait, addWs, removeWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup, getWs } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";
import { handleGroupIncrease } from "./handlers/group-increase.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

function getLogger(api) {
    return api?.logger ?? {};
}

/**
 * 为单个账号创建连接并设置消息处理
 */
async function startAccountConnection(api, accountId, config) {
    const log = getLogger(api);
    try {
        let ws;
        if (config.type === "forward-websocket") {
            ws = await connectForward(config);
        } else {
            ws = await createServerAndWait(config);
        }
        addWs(accountId, ws);
        log.info?.(`[onebot] WebSocket connected (accountId=${accountId})`);
        
        ws.on("message", (data) => {
            try {
                const payload = JSON.parse(data.toString());
                if (handleEchoResponse(payload)) return;
                if (payload.meta_event_type === "heartbeat") return;
                
                const msg = payload;
                if (msg.post_type === "message" && (msg.message_type === "private" || msg.message_type === "group")) {
                    // 传递 accountId 给消息处理器
                    processInboundMessage(api, msg, accountId).catch((e) => {
                        log.error?.(`[onebot] processInboundMessage: ${e?.message}`);
                    });
                } else if (msg.post_type === "notice" && msg.notice_type === "group_increase") {
                    handleGroupIncrease(api, msg).catch((e) => {
                        log.error?.(`[onebot] handleGroupIncrease: ${e?.message}`);
                    });
                }
            } catch (e) {
                log.error?.(`[onebot] parse message: ${e?.message}`);
            }
        });
        
        ws.on("close", () => {
            log.info?.(`[onebot] WebSocket closed (accountId=${accountId})`);
            removeWs(accountId);
        });
        
        ws.on("error", (e) => {
            log.error?.(`[onebot] WebSocket error (accountId=${accountId}): ${e?.message}`);
        });
        
        return true;
    } catch (e) {
        log.error?.(`[onebot] start failed (accountId=${accountId}): ${e?.message}`);
        return false;
    }
}

export function registerService(api) {
    api.registerService({
        id: "onebot-ws",
        start: async () => {
            const accountIds = listAccountIds(api);
            const log = getLogger(api);
            
            if (accountIds.length === 0) {
                log.warn?.("[onebot] no config, service will not connect");
                return;
            }
            
            log.info?.(`[onebot] starting connections for ${accountIds.length} account(s): ${accountIds.join(", ")}`);
            
            startImageTempCleanup();
            startScheduler(api);
            
            // 为每个账号创建连接
            const results = await Promise.all(
                accountIds.map(async (accountId) => {
                    const config = getOneBotConfig(api, accountId);
                    if (!config || config.enabled === false) {
                        log.info?.(`[onebot] skipping accountId=${accountId} (not configured or disabled)`);
                        return false;
                    }
                    return startAccountConnection(api, accountId, config);
                })
            );
            
            const successCount = results.filter(Boolean).length;
            log.info?.(`[onebot] ${successCount}/${accountIds.length} connection(s) established`);
        },
        stop: async () => {
            stopImageTempCleanup();
            stopScheduler();
            stopConnection();
            getLogger(api).info?.("[onebot] service stopped");
        },
    });
}
