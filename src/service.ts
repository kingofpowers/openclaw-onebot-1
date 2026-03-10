/**
 * OneBot WebSocket 服务（多账号支持）
 */

import type { OneBotMessage } from "./types.js";
import { getOneBotConfig, listAccountIds, invalidateConfigCache } from "./config.js";
import { connectForward, createServerAndWait, addWs, removeWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";
import { handleGroupIncrease } from "./handlers/group-increase.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import { watch } from "fs";
import { access, constants } from "fs/promises";

function getLogger(api: any) {
    return api?.logger ?? {};
}

let configWatcher: ReturnType<typeof watch> | null = null;
let lastReloadTime = 0;
let configPollTimer: ReturnType<typeof setInterval> | null = null;
const RELOAD_DEBOUNCE_MS = 1000; // 防抖 1 秒
const CONFIG_POLL_INTERVAL_MS = 5000; // 轮询间隔 5 秒

/**
 * 为单个账号创建连接并设置消息处理
 */
async function startAccountConnection(api: any, accountId: string, config: any): Promise<boolean> {
    const log = getLogger(api);
    try {
        let ws;
        if (config.type === "forward-websocket") {
            ws = await connectForward(config);
        } else {
            ws = await createServerAndWait(config);
        }
        addWs(accountId, ws!);
        log.info?.(`[onebot] WebSocket connected (accountId=${accountId})`);

        ws!.on("message", (data: Buffer) => {
            try {
                const payload = JSON.parse(data.toString());
                if (handleEchoResponse(payload)) return;
                if (payload.meta_event_type === "heartbeat") return;

                const msg = payload as OneBotMessage;
                if (msg.post_type === "message" && (msg.message_type === "private" || msg.message_type === "group")) {
                    processInboundMessage(api, msg, accountId).catch((e) => {
                        log.error?.(`[onebot] processInboundMessage: ${e?.message}`);
                    });
                } else if (msg.post_type === "notice" && msg.notice_type === "group_increase") {
                    handleGroupIncrease(api, msg).catch((e) => {
                        log.error?.(`[onebot] handleGroupIncrease: ${e?.message}`);
                    });
                }
            } catch (e: any) {
                log.error?.(`[onebot] parse message: ${e?.message}`);
            }
        });

        ws!.on("close", () => {
            log.info?.(`[onebot] WebSocket closed (accountId=${accountId})`);
            removeWs(accountId);
        });

        ws!.on("error", (e: Error) => {
            log.error?.(`[onebot] WebSocket error (accountId=${accountId}): ${e?.message}`);
        });

        return true;
    } catch (e: any) {
        log.error?.(`[onebot] start failed (accountId=${accountId}): ${e?.message}`);
        return false;
    }
}

/**
 * 停止所有连接并重新加载配置
 */
async function reloadConnections(api: any): Promise<void> {
    const log = getLogger(api);
    const now = Date.now();

    // 防抖：避免短时间内多次触发
    if (now - lastReloadTime < RELOAD_DEBOUNCE_MS) {
        return;
    }
    lastReloadTime = now;

    log.info?.("[onebot] reloading connections due to config change...");

    // 清除配置缓存
    invalidateConfigCache();

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
async function getConfigPath(api: any): Promise<string | null> {
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
 * 启动配置轮询（作为 Docker 环境的备选）
 */
function startConfigPoll(api: any): void {
    if (configPollTimer) return;

    configPollTimer = setInterval(() => {
        // 清除缓存，下次访问时重新读取
        invalidateConfigCache();
    }, CONFIG_POLL_INTERVAL_MS);
}

/**
 * 停止配置轮询
 */
function stopConfigPoll(): void {
    if (configPollTimer) {
        clearInterval(configPollTimer);
        configPollTimer = null;
    }
}

export function registerService(api: any): void {
    api.registerService({
        id: "onebot-ws",
        start: async () => {
            const accountIds = listAccountIds(api);
            if (accountIds.length === 0) {
                api.logger?.warn?.("[onebot] no config, service will not connect");
                return;
            }

            try {
                // 启动所有账号连接
                const results = await Promise.all(
                    accountIds.map(async (accountId) => {
                        const config = getOneBotConfig(api, accountId);
                        if (!config || config.enabled === false) {
                            api.logger?.info?.(`[onebot] skipping accountId=${accountId} (not configured or disabled)`);
                            return false;
                        }
                        return startAccountConnection(api, accountId, config);
                    })
                );

                const successCount = results.filter(Boolean).length;
                api.logger?.info?.(`[onebot] ${successCount}/${accountIds.length} connection(s) established`);

                startImageTempCleanup();
                startScheduler(api);

                // 启动配置文件监听（热重载）
                const configPath = await getConfigPath(api);
                if (configPath) {
                    api.logger?.info?.(`[onebot] watching config file: ${configPath}`);

                    // 启动轮询作为备选（Docker 环境中 fs.watch 可能不工作）
                    startConfigPoll(api);

                    configWatcher = watch(configPath, { persistent: true, recursive: false }, (eventType) => {
                        api.logger?.info?.(`[onebot] config file event: ${eventType}`);
                        // rename 或 change 都触发重载（某些系统使用 rename）
                        setTimeout(() => {
                            reloadConnections(api).catch((e) => {
                                api.logger?.error?.(`[onebot] reload failed: ${e?.message}`);
                            });
                        }, 100);
                    });
                }
            } catch (e: any) {
                api.logger?.error?.(`[onebot] start failed: ${e?.message}`);
            }
        },
        stop: async () => {
            stopConfigPoll();
            if (configWatcher) {
                configWatcher.close();
                configWatcher = null;
            }
            stopImageTempCleanup();
            stopScheduler();
            stopConnection();
            api.logger?.info?.("[onebot] service stopped");
        },
    });
}
