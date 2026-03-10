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
- ✅ 自动获取上下文
- ✅ 新成员入群欢迎
- ✅ 自动合并转发长消息
- ✅ **长消息生成图片**：超过阈值可将 Markdown 渲染为图片发送（可选主题：default / dust / custom 自定义 CSS）
- ✅ 支持文件，图像读取/上传
- ✅ 支持白名单系统
- ✅ 通过 `openclaw message send` CLI 发送（无 Agent 工具，降低 token 消耗）

## 安装

```bash
openclaw plugins install @kirigaya/openclaw-onebot
openclaw onebot setup
```

## 安装 onebot 服务端

你需要安装 onebot 服务端，QQ 目前比较常用的是 onebot 服务端是 NapCat，可以查看 [官网](https://napneko.github.io/) 了解安装方法


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

## 多账号配置

支持同时连接多个 OneBot 实例（如多个 QQ 号）：

```json
{
  "channels": {
    "onebot": {
      "accounts": {
        "main": {
          "type": "forward-websocket",
          "host": "napcat",
          "port": 3001,
          "accessToken": "your-token-1"
        },
        "macro": {
          "type": "forward-websocket",
          "host": "napcat2",
          "port": 3011,
          "accessToken": "your-token-2"
        }
      }
    }
  }
}
```

每个账号独立连接，可通过 `bindings` 配置路由到不同的 Agent。

## 配置热重载

修改 `openclaw.json` 后，配置会自动生效（无需重启 Gateway）：

- `requireMention` 等配置实时更新
- Docker 环境中自动启用轮询备选方案
- 支持新增/删除账号连接

## 长消息处理与 OG 图片渲染

当单次回复超过**长消息阈值**（默认 300 字）时，可选用三种模式（`openclaw onebot setup` 中配置）：

| 模式 | 说明 |
|------|------|
| `normal` | 正常分段发送 |
| `og_image` | 将 Markdown 转为 HTML 再生成图片发送（需安装 `node-html-to-image`） |
| `forward` | 合并转发（发给自己后打包转发） |

选择 **生成图片发送（og_image）** 时，会额外询问**渲染主题**：

| 选项 | 说明 |
|------|------|
| **default** | 无额外样式，默认白底黑字 |
| **dust** | 内置主题：暖色、旧纸质感 |
| **custom** | 自定义：在 `ogImageRenderThemePath` 中填写 CSS 文件绝对路径 |

配置项（枚举 + 可选路径）：

- `ogImageRenderTheme`：`"default"` | `"dust"` | `"custom"`
- `ogImageRenderThemePath`：当为 `custom` 时必填，CSS 文件绝对路径

示例（`openclaw.json`）：

```json
{
  "channels": {
    "onebot": {
      "longMessageMode": "og_image",
      "longMessageThreshold": 300,
      "ogImageRenderTheme": "dust"
    }
  }
}
```

自定义主题示例：

```json
{
  "channels": {
    "onebot": {
      "longMessageMode": "og_image",
      "ogImageRenderTheme": "custom",
      "ogImageRenderThemePath": "C:/path/to/your-theme.css"
    }
  }
}
```

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

## 消息过滤

### 排除消息

某些消息不需要触发 AI 回复（如错误消息），可以通过 `skipMessages` 配置：

```json
{
  "channels": {
    "onebot": {
      "skipMessages": [
        "An unknown error occurred",
        "你好，我无法给到相关内容。"
      ]
    }
  }
}
```

默认已排除常见错误消息，配置后会追加到默认列表。

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

## 测试

### 测试连接

项目内提供测试脚本（需 `.env` 或环境变量）：

```bash
cd openclaw-onebot
npm run test:connect
```

### 测试 OG 图片渲染效果

用于预览「Markdown 转图片」在不同主题下的渲染效果（需安装 `node-html-to-image`）：

```bash
cd openclaw-onebot
# 无额外样式
npm run test:render-og-image -- default
# 内置 dust 主题
npm run test:render-og-image -- dust
# 自定义 CSS 文件（绝对路径）
npm run test:render-og-image -- "C:/path/to/your-theme.css"
```

生成图片保存在 `test/output-render-<主题>.png`，可直接打开查看。

## 参考

- [OneBot 11](https://github.com/botuniverse/onebot-11)
- [go-cqhttp](https://docs.go-cqhttp.org/)
- [Lagrange.Core](https://github.com/LSTM-Kirigaya/Lagrange.Core)
- [NapCat](https://github.com/NapNeko/NapCatQQ)

## License

MIT © [LSTM-Kirigaya](https://github.com/LSTM-Kirigaya)
