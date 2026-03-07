/**
 * 新成员入群欢迎 - 模板（接入你自己的图片生成函数）
 *
 * 使用步骤：
 * 1. 复制此文件，重命名为 my-welcome.ts
 * 2. 在 generateImage 中调用你的图片生成逻辑
 * 3. 在 openclaw.json 中配置 handler 指向你的脚本
 *
 * 配置示例：
 * "channels": { "onebot": { "groupIncrease": { "enabled": true, "handler": "./scripts/my-welcome.ts" } } }
 */

/** ctx 包含：groupId, groupName, userId, userName, avatarUrl */
export default async function (ctx: {
  groupId: number;
  groupName: string;
  userId: number;
  userName: string;
  avatarUrl: string;
}) {
  // 调用你的图片生成函数，传入新成员信息
  const imagePath = await yourGenerateImage(ctx);

  return {
    text: `欢迎 ${ctx.userName} 加入 ${ctx.groupName}！`,
    imagePath,
  };
}

/**
 * 在此实现你的图片生成逻辑
 * 可根据 ctx.userId、ctx.userName、ctx.avatarUrl、ctx.groupName 等生成图片
 * 返回本地文件路径（绝对路径或 file:// 开头）
 */
async function yourGenerateImage(ctx: {
  userId: number;
  userName: string;
  avatarUrl: string;
  groupName: string;
}): Promise<string> {
  // TODO: 替换为你的图片生成逻辑
  // 例如：使用 canvas、sharp、node-html-to-image 等
  throw new Error("请实现 yourGenerateImage 函数");
}
