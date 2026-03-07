/**
 * 新成员入群欢迎 - command 示例（输出 JSON 供 handler 发送）
 *
 * 配置：在 openclaw.json 中设置
 *   "channels": { "onebot": { "groupIncrease": {
 *     "enabled": true,
 *     "command": "npx tsx scripts/group-welcome-example.ts",
 *     "cwd": "C:/path/to/openclaw-onebot"
 *   } } }
 *
 * 环境变量：GROUP_ID, GROUP_NAME, USER_ID, USER_NAME, AVATAR_URL
 * 向 stdout 输出一行 JSON：{"text":"...","imagePath":"..."} 或 {"imageUrl":"..."}
 */

import { join } from "path";
import { tmpdir } from "os";

async function main() {
  const groupId = process.env.GROUP_ID || "";
  const groupName = process.env.GROUP_NAME || "";
  const userId = process.env.USER_ID || "";
  const userName = process.env.USER_NAME || userId;
  const avatarUrl = process.env.AVATAR_URL || "";

  if (!groupId) {
    console.error("[welcome] GROUP_ID required");
    process.exit(1);
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: sans-serif; padding: 24px; margin: 0; background: linear-gradient(135deg,#667eea,#764ba2); color: #fff; }
  .card { background: rgba(255,255,255,0.15); border-radius: 12px; padding: 24px; text-align: center; }
  .avatar { width: 80px; height: 80px; border-radius: 50%; margin-bottom: 12px; }
  .name { font-size: 20px; font-weight: bold; }
  .msg { margin-top: 8px; opacity: 0.9; }
</style></head>
<body>
  <div class="card">
    <img class="avatar" src="${avatarUrl.replace(/"/g, "&quot;")}" alt="头像" />
    <div class="name">${userName.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    <div class="msg">欢迎加入 ${groupName.replace(/</g, "&lt;")}！</div>
  </div>
</body>
</html>`;

  // 需安装 node-html-to-image：npm install node-html-to-image
  const { default: nodeHtmlToImage } = await import("node-html-to-image");
  const outPath = join(tmpdir(), `welcome-${userId}-${Date.now()}.png`);
  await nodeHtmlToImage({
    html,
    output: outPath,
    type: "png",
    puppeteerArgs: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

  const result = {
    text: `欢迎 ${userName} 加入 ${groupName}！`,
    imagePath: outPath,
  };
  console.log(JSON.stringify(result));
}

main().catch((e) => {
  console.error("[welcome] error:", e);
  process.exit(1);
});
