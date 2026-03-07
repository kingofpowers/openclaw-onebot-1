# 配置参数

## 参数表

| 参数 | 说明 |
|------|------|
| type | `forward-websocket` / `backward-websocket` |
| host | OneBot 主机地址 |
| port | 端口 |
| accessToken | 访问令牌（可选） |
| path | 反向 WS 路径，默认 `/onebot/v11/ws` |
| requireMention | 群聊是否需 @ 才回复，默认 `true` |
| whitelistUserIds | 白名单 QQ 号数组，非空时仅白名单内用户可触发 AI；为空则所有人可回复 |
| renderMarkdownToPlain | 是否将 Markdown 转为纯文本再发送，默认 `true` |
| collapseDoubleNewlines | 是否将连续多个换行压缩为单个，默认 `true`（减少 AI 输出的双空行） |
| longMessageMode | 长消息模式：`normal` 正常发送、`og_image` 生成图片、`forward` 合并转发 |
| 调试 | 设置 `OPENCLAW_ONEBOT_SEND_DEBUG=1` 可启用发送调试日志，写入 `openclaw-onebot/send-debug.log`（绝对路径见日志首行） |
| longMessageThreshold | 长消息阈值（字符数），超过则启用 longMessageMode，默认 300 |
| thinkingEmojiId | 表情 ID（set_msg_emoji_like），默认 60 |
| groupIncrease | 新成员入群欢迎（enabled、message、command、cwd），详见 [receive.md](receive.md) |
| cronJobs | 内置定时任务（无 AI 介入），详见下方 |

## TUI 配置

运行 `openclaw onebot setup` 进行交互式配置。

配置写入 `openclaw.json` 的 `channels.onebot` 或通过 `ONEBOT_WS_*` 环境变量提供。

## 环境变量

| 变量 | 说明 |
|------|------|
| ONEBOT_WS_TYPE | forward-websocket / backward-websocket |
| ONEBOT_WS_HOST | 主机地址 |
| ONEBOT_WS_PORT | 端口 |
| ONEBOT_WS_ACCESS_TOKEN | 访问令牌 |
| ONEBOT_WS_PATH | 反向 WS 路径 |

## cronJobs 配置

在 `openclaw.json` 中配置内置定时任务，直接执行脚本并推送到群，无需 AI 介入：

```json
{
  "channels": {
    "onebot": {
      "cronJobs": [
        {
          "name": "每日科技新闻",
          "cron": "0 8 * * *",
          "timezone": "Asia/Shanghai",
          "script": "./Tiphareth/src/openclaw/cron/daily-news.ts",
          "groupIds": [782833642, 1046693162]
        }
      ]
    }
  }
}
```

脚本需导出 `default` / `run` / `execute` 函数，接收 `ctx: { onebot, groupIds }`。

## 长消息处理

当单次回复超过 `longMessageThreshold` 字符时，根据 `longMessageMode` 处理：

| 模式 | 说明 |
|------|------|
| normal | 正常分段发送（默认） |
| og_image | 将 Markdown 渲染为 HTML 并生成图片发送。需安装 `node-html-to-image`：`npm install node-html-to-image`。此模式下保留 Markdown 格式与代码高亮 |
| forward | 将各块消息先发给自己，再打包为合并转发发送。需 OneBot 实现支持 `send_group_forward_msg` / `send_private_forward_msg` |
