/**
 * OneBot WebSocket 服务（多账号支持）
 */
import { getOneBotConfig, listAccountIds, invalidateConfigCache } from "./config.js";
import { connectForward, createServerAndWait, addWs, removeWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup, getWs } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";
import { handleGroupIncrease } from "./handlers/group-increase.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { watch } from "fs";
import { access, constants } from "fs/promises";

function getLogger(api) {
    return api?.logger ?? {};
}

let configWatcher = null;
let lastReloadTime = 0;
const RELOAD_DEBOUNCE_MS = 1000; // 防抖 1 秒

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

/**
 * 停止所有连接并重新加载配置
 */
async function reloadConnections(api) {
    const log = getLogger(api);
    const now = Date.now();
    
    // 防抖：避免短时间内多次触发
    if (now - lastReloadTime < RELOAD_DEBOUNCE_MS) {
        return;
    }
    lastReloadTime = now;
    
    log.info?.("[onebot] reloading connections due to config change...");
    
    // 停止现有连接
    stopConnection();
    
    // 重新加载配置并建立连接
    const accountIds = listAccountIds(api);
    if (accountIds.length === 0) {
        log.warn?.("[onebot] no config after reload");
        return;
    }
    
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
    log.info?.(`[onebot] reloaded: ${successCount}/${accountIds.length} connection(s) established`);
}

/**
 * 获取配置文件路径
 */
async function getConfigPath(api) {
    // 尝试常见配置文件路径
    const possiblePaths = [
        api.configPath,
        process.env.OPENCLAW_CONFIG,
        "/home/node/.openclaw/openclaw.json",
        "/app/openclaw.json",
    ].filter(Boolean);
    
    for (const path of possiblePaths) {
        try {
            await access(path, constants.R_OK);
            return path;
        } catch {
            continue;
        }
    }
    return null;
}

/**
 * 启动配置文件监听
 */
async function startConfigWatcher(api) {
    const log = getLogger(api);
    const configPath = await getConfigPath(api);
    
    if (!configPath) {
        log.warn?.("[onebot] config file not found, hot reload disabled");
        return;
    }
    
    log.info?.(`[onebot] watching config file: ${configPath}`);
    
    configWatcher = watch(configPath, (eventType) => {
        if (eventType === "change") {
            log.info?.(`[onebot] config file changed, invalidating cache...`);
            // 清除配置缓存，下次读取时会重新加载
            invalidateConfigCache();
            // 延迟一小段时间，确保文件写入完成
            setTimeout(() => {
                reloadConnections(api).catch((e) => {
                    log.error?.(`[onebot] reload failed: ${e?.message}`);
                });
            }, 100);
        }
    });
    
    configWatcher.on("error", (e) => {
        log.error?.(`[onebot] config watcher error: ${e?.message}`);
    });
}

/**
 * 停止配置文件监听
 */
function stopConfigWatcher() {
    if (configWatcher) {
        configWatcher.close();
        configWatcher = null;
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
            
            // 启动配置文件热加载监听
            startConfigWatcher(api).catch((e) => {
                log.error?.(`[onebot] failed to start config watcher: ${e?.message}`);
            });
        },
        stop: async () => {
            stopConfigWatcher();
            stopImageTempCleanup();
            stopScheduler();
            stopConnection();
            getLogger(api).info?.("[onebot] service stopped");
        },
    });
}
