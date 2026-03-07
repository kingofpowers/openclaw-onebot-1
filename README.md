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

#### 多 NapCat 容器部署示例

多个 QQ 账号需要多个 NapCat 容器，以下是 `docker-compose.yml` 示例：

```yaml
version: "3"
services:
  napcat:
    environment:
      - NAPCAT_UID=1000
      - NAPCAT_GID=1000
    ports:
      - 3000:3000      # WebUI
      - 3001:3001      # WebSocket 服务器（正向 WS）
      - 6099:6099      # 文件管理
    container_name: napcat
    restart: always
    image: mlikiowa/napcat-docker:latest
    volumes:
      - ./napcat-plugin-openclaw:/app/napcat/plugins/napcat-plugin-openclaw
      - ./cache:/app/napcat/cache
    networks:
      - openclaw-network

  napcat2:
    environment:
      - NAPCAT_UID=1000
      - NAPCAT_GID=1000
    ports:
      - 3100:3000      # WebUI
      - 3101:3001      # WebSocket 服务器（正向 WS）
      - 6199:6099      # 文件管理
    container_name: napcat2
    restart: always
    image: mlikiowa/napcat-docker:latest
    volumes:
      - ./napcat-plugin-openclaw:/app/napcat/plugins/napcat-plugin-openclaw
      - ./cache2:/app/napcat/cache
    networks:
      - openclaw-network

networks:
  openclaw-network:
    driver: bridge
    name: openclaw-network
```

**配置说明**：

1. 分别访问 WebUI 配置 WebSocket：
   - napcat: http://127.0.0.1:6099/webui
   - napcat2: http://127.0.0.1:6199/webui

2. 在 WebUI → 网络配置中添加 **WebSocket 服务器**：
   - napcat: 监听端口 `3001`
   - napcat2: 监听端口 `3001`（容器内）

3. OpenClaw 配置：
```json
{
  "channels": {
    "onebot": {
      "accounts": {
        "main": {
          "type": "forward-websocket",
          "host": "napcat",
          "port": 3001
        },
        "macro": {
          "type": "forward-websocket",
          "host": "napcat2",
          "port": 3001
        }
      }
    }
  }
}
```

**注意**：多个 NapCat 容器需要使用不同的 `cache` 目录，否则会产生冲突。


## 配置

### 单账号配置（简化格式）

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "type": "forward-websocket",
      "host": "napcat",
      "port": 3001,
      "accessToken": "your-token",
      "requireMention": true,
      "groupHistoryOnMention": true
    }
  }
}
```

### 多账号配置

支持多个 QQ 账号同时连接，每个账号可绑定不同的 Agent：

```json
{
  "channels": {
    "onebot": {
      "enabled": true,
      "requireMention": true,
      "groupHistoryOnMention": true,
      "accounts": {
        "main": {
          "type": "backward-websocket",
          "port": 18790,
          "accessToken": "token-main"
        },
        "stock-picker": {
          "type": "forward-websocket",
          "host": "napcat-stock",
          "port": 3001,
          "accessToken": "token-stock"
        },
        "macro": {
          "type": "forward-websocket",
          "host": "napcat-macro",
          "port": 3011,
          "accessToken": "token-macro"
        }
      }
    }
  },
  "agents": {
    "list": [
      { "id": "main", "default": true },
      { "id": "stock-picker", "workspace": "/path/to/workspace-stock-picker" },
      { "id": "macro", "workspace": "/path/to/workspace-macro" }
    ],
    "bindings": [
      {
        "agentId": "stock-picker",
        "match": { "channel": "onebot", "accountId": "stock-picker" }
      },
      {
        "agentId": "macro",
        "match": { "channel": "onebot", "accountId": "macro" }
      },
      {
        "agentId": "main",
        "match": { "channel": "onebot", "accountId": "main" }
      }
    ]
  }
}
```

**配置说明**：

| 配置项 | 说明 |
|--------|------|
| `accounts` | 账号配置对象，键为账号 ID（如 `main`、`stock-picker`） |
| `accounts.<id>.type` | 连接类型：`forward-websocket` 或 `backward-websocket` |
| `accounts.<id>.host` | 正向 WS 时，NapCat 的主机地址 |
| `accounts.<id>.port` | 端口号 |
| `accounts.<id>.accessToken` | 访问令牌 |
| `bindings` | Agent 绑定规则，按 `accountId` 路由到不同 Agent |

**混合模式**：不同账号可使用不同的连接类型，例如：
- `main`：反向 WebSocket（NapCat 主动连接 OpenClaw）
- `stock-picker`：正向 WebSocket（OpenClaw 主动连接 NapCat）

**Agent 绑定方式**：

| 绑定维度 | 示例 | 说明 |
|----------|------|------|
| 按账号 | `{ "accountId": "stock-picker" }` | 该账号所有消息都路由到指定 Agent |
| 按群 | `{ "peer": { "kind": "group", "id": "12345" } }` | 该群消息路由到指定 Agent |
| 混合 | 同时指定 `accountId` 和 `peer` | 精确匹配 |

**向前兼容**：单账号的扁平配置格式仍然有效，自动作为 `default` 账号。

### 账号级别配置

每个账号可以独立配置行为设置，支持以下配置项：

| 配置项 | 说明 |
|--------|------|
| `requireMention` | 是否需要 @ 才响应 |
| `groupHistoryOnMention` | 被 @ 时是否获取群历史消息 |
| `groupHistoryLimit` | 获取历史消息的数量 |
| `groups` | 按群覆盖配置 |

**配置优先级**：账号群配置 > 账号配置 > 全局群配置 > 全局配置

```json
{
  "channels": {
    "onebot": {
      "requireMention": true,
      "groupHistoryOnMention": true,
      "groups": {
        "1091416099": { "requireMention": false }
      },
      "accounts": {
        "main": {
          "type": "backward-websocket",
          "port": 18790
        },
        "macro": {
          "type": "forward-websocket",
          "host": "napcat2",
          "port": 3011,
          "requireMention": false,
          "groupHistoryOnMention": false,
          "groups": {
            "12345678": { "requireMention": true }
          }
        }
      }
    }
  }
}
```

**上述配置效果**：

| 账号 | 群 | requireMention | 说明 |
|------|-----|----------------|------|
| main | 所有群 | true | 全局配置 |
| main | 1091416099 | false | 全局群配置覆盖 |
| macro | 所有群 | false | 账号配置覆盖全局 |
| macro | 12345678 | true | 账号群配置覆盖账号配置 |

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
