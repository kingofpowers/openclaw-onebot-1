/**
 * Agent 工具注册
 * 供 OpenClaw cron 等场景下，AI 调用 OneBot 能力
 */
import { sendPrivateMsg, sendGroupMsg, sendGroupImage, sendPrivateImage, getGroupMsgHistory, getGroupInfo, getStrangerInfo, getGroupMemberInfo, getAvatarUrl } from "./connection.js";
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
export declare const onebotClient: OneBotClient;
export declare function registerTools(api: any): void;
