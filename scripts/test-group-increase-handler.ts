/**
 * 测试入群欢迎 command 执行
 * 用法：cd openclaw-onebot && npx tsx scripts/test-group-increase-handler.ts
 *
 * 模拟 group-increase 的 command 执行流程，验证 welcome.ts 能否正常运行。
 * 需 Gateway 已启动且 openclaw CLI 可用，否则 openclaw message send 会失败。
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
const tipharethRoot = resolve(projectRoot, "Tiphareth");

function runCommand(
  command: string,
  cwd: string,
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "sh";
    const shellArg = isWin ? "/c" : "-c";

    const child = spawn(shell, [shellArg, command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });

    child.on("close", (code) => {
      resolvePromise({ stdout, stderr, code });
    });
  });
}

function escapeForShell(s: string): string {
  const str = String(s);
  if (process.platform === "win32") {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

async function main() {
  const command = "npx tsx src/openclaw/trigger/welcome.ts";
  const args = { userId: "789", username: "测试用户", groupId: "123456" };
  const fullCmd = `${command} --userId ${args.userId} --username ${escapeForShell(args.username)} --groupId ${args.groupId}`;
  const cwd = tipharethRoot;
  const env = {
    GROUP_NAME: "测试群",
    AVATAR_URL: "https://q1.qlogo.cn/g?b=qq&nk=789&s=640",
    DRY_RUN: "1",
  };

  console.log("[测试] 执行 command（DRY_RUN=1，仅生成图片不发送）...");
  console.log("  command:", fullCmd);
  console.log("  cwd:", cwd);

  const { stdout, stderr, code } = await runCommand(fullCmd, cwd, env);

  if (stdout) console.log("[测试] stdout:", stdout);
  if (stderr) console.log("[测试] stderr:", stderr);
  console.log("[测试] exit code:", code);

  if (code !== 0) {
    console.error("[测试] 失败: command 非零退出");
    process.exit(1);
  }

  try {
    const line = stdout.trim().split("\n").pop();
    if (line) {
      const data = JSON.parse(line);
      console.log("[测试] 输出 JSON:", data);
    }
  } catch {
    // 非 DRY_RUN 模式下可能无 JSON
  }

  console.log("[测试] 成功");
}

main().catch((e) => {
  console.error("[测试] 失败:", e);
  process.exit(1);
});
