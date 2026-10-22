import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = ["@prompt-studio/api", "@prompt-studio/web"].map((workspace) =>
  spawn(npm, ["run", "dev", "--workspace", workspace], {
    stdio: "inherit",
    detached: process.platform !== "win32",
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stop());
for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
