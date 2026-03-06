<div align="center">

# openclaw-onebot

[OpenClaw](https://openclaw.ai)  的 **OneBot v11 协议**（QQ/Lagrange.Core、go-cqhttp 等）渠道插件。

[![npm version](https://img.shields.io/npm/v/@kirigaya/openclaw-onebot?style=flat-square)](https://www.npmjs.com/package/@kirigaya/openclaw-onebot)
[![GitHub stars](https://img.shields.io/github/stars/LSTM-Kirigaya/openclaw-onebot?style=flat-square)](https://github.com/LSTM-Kirigaya/openclaw-onebot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square)](https://www.typescriptlang.org/)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Plugin-9cf?style=flat-square)](https://openclaw.ai)

</div>

---

## 教程

📖 **完整安装与配置教程**：[让 QQ 接入 openclaw！让你的助手掌管千人大群](https://kirigaya.cn/blog/article?seq=368)

## 功能

- ✅ 私聊：所有消息 AI 都会回复
- ✅ 群聊：仅当用户 @ 机器人时回复（可配置）
- ✅ 正向 / 反向 WebSocket 连接
- ✅ TUI 配置向导：`openclaw onebot setup`
- ✅ 新成员入群欢迎
- ✅ 通过 `openclaw message send` CLI 发送（无 Agent 工具，降低 token 消耗）

## 安装

```bash
openclaw plugins install @kirigaya/openclaw-onebot
openclaw onebot setup
```

## 安装 onebot 服务端

你需要安装 onebot 服务端，QQ 目前比较常用的是 onebot 服务端是 NapCat，可以查看 [官网](https://napneko.github.io/) 了解安装方法

### NapCat 配置

在 NapCat 的网络配置中添加以下连接：

#### 方式 1：反向 WebSocket（推荐）

OpenClaw 作为服务端，NapCat 主动连接：

1. 在 NapCat 网络配置中添加 **WebSocket 客户端**
2. URL：`ws://openclaw-gateway:18790/onebot/v11/ws`
   - `openclaw-gateway` 需要在同一个 Docker network 中
   - 或直接使用 OpenClaw 容器的 IP 地址
3. Token：与 `openclaw.json` 中的 `accessToken` 保持一致

#### 方式 2：正向 WebSocket

OpenClaw 主动连接 NapCat：

1. 在 NapCat 网络配置中添加 **WebSocket 服务器**
2. 监听端口：`3001`
3. 在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "type": "forward-websocket",
      "host": "napcat",
      "port": 3001
    }
  }
}
```

#### Docker Network 配置示例

```bash
# 创建共享网络
docker network create openclaw-net

# OpenClaw 容器加入网络
docker network connect openclaw-net openclaw-gateway

# NapCat 容器加入网络
docker network connect openclaw-net napcat
```


### 连接类型

| 类型 | 说明 |
|------|------|
| `forward-websocket` | 插件主动连接 OneBot（go-cqhttp、Lagrange.Core 正向 WS） |
| `backward-websocket` | 插件作为服务端，OneBot 连接过来 |

### 环境变量

可替代配置文件，适用于 Lagrange 等：

| 变量 | 说明 |
|------|------|
| `ONEBOT_WS_TYPE` | forward-websocket / backward-websocket |
| `ONEBOT_WS_HOST` | 主机地址 |
| `ONEBOT_WS_PORT` | 端口 |
| `ONEBOT_WS_ACCESS_TOKEN` | 访问令牌 |

## 使用

1. 安装并配置
2. 重启 Gateway：`openclaw gateway restart`
3. 在 QQ 私聊或群聊中发消息（群聊需 @ 机器人）

## 主动发送消息

通过 `openclaw message send` CLI（无需 Agent 工具）：

```bash
# 发送文本
openclaw message send --channel onebot --target user:123456789 --message "你好"

# 发送图片
openclaw message send --channel onebot --target group:987654321 --media "file:///path/to/image.png"
```

`--target` 格式：`user:QQ号` 或 `group:群号`。回复场景由 deliver 自动投递，Agent 输出 text/mediaUrl 即会送达。

## 新成员入群欢迎（自定义图片）

当有新成员加入群时，可根据其 ID 信息生成欢迎图片并发送。详见 [receive.md](skills/onebot-ops/receive.md#新成员入群欢迎)。

1. 在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "onebot": {
      "groupIncrease": {
        "enabled": true,
        "command": "npx tsx src/openclaw/trigger/welcome.ts",
        "cwd": "C:/path/to/Tiphareth"
      }
    }
  }
}
```

2. `command` 在 `cwd` 下用系统 shell 执行，环境变量传入 `GROUP_ID`、`GROUP_NAME`、`USER_ID`、`USER_NAME`、`AVATAR_URL`。命令可调用 `openclaw message send` 自行发送，或向 stdout 输出 JSON 行供 handler 发送。

3. 测试：`npm run test:group-increase-handler`（DRY_RUN 模式，仅生成图片）

## 回复白名单

默认为空回复所有人的消息。如果设置的话，那么机器人就只会回复设置的数组里的用户的消息。

```json
{
  "channels": {
    "onebot": {
      "whitelistUserIds": [1193466151],
    }
  }
}
```

## 群聊历史消息上下文

当机器人在群聊中被 @ 时，可以自动获取最近的聊天记录作为上下文，让 AI 更好地理解对话内容。

```json
{
  "channels": {
    "onebot": {
      "requireMention": true,
      "groupHistoryOnMention": true,
      "groupHistoryLimit": 50
    }
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `requireMention` | boolean | false | 群聊是否需要 @ 才响应 |
| `groupHistoryOnMention` | boolean | false | 被 @ 时是否获取历史消息 |
| `groupHistoryLimit` | number | 50 | 获取历史消息的最大数量 |

历史消息会格式化为：

```
【群聊历史记录】
[用户A]: 今天天气真好
[用户B]: 是啊，适合出去玩
【以上是历史消息】

用户消息: @机器人 你觉得呢？
```

## 新人入群触发器

如果有人入群之后，可以通过这个来实现触发器。

```json
{
  "channels": {
    "onebot": {
      "groupIncrease": {
        "enabled": true,
        "command": "npx tsx welcome.ts",
        "cwd": "/path/to/triggers"
      }
    }
  }
}
```

实现的脚本必须支持这三个参数：

```
--userId ${userId} --username ${username} --groupId ${groupId}
```

## 测试连接

项目内提供测试脚本（需 `.env` 或环境变量）：

```bash
cd openclaw-onebot
npm run test:connect
```

## 参考

- [OneBot 11](https://github.com/botuniverse/onebot-11)
- [go-cqhttp](https://docs.go-cqhttp.org/)
- [Lagrange.Core](https://github.com/LSTM-Kirigaya/Lagrange.Core)
- [NapCat](https://github.com/NapNeko/NapCatQQ)

## License

MIT © [LSTM-Kirigaya](https://github.com/LSTM-Kirigaya)
