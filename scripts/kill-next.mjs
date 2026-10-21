/**
 * Kill any running Next.js dev/start servers started by this project.
 *
 * The search terms are assembled at runtime from fragments so that this
 * script's OWN command line (which contains the script path) can never
 * match itself — a self-matching `pkill -f` would kill the shell that
 * invoked it.
 */
import fs from "node:fs";

const NEEDLES = ["next" + "-server", "next" + " dev", "next" + " start"];
const me = process.pid;
const parent = process.ppid;
const killed = [];

for (const dir of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(dir)) continue;
  const pid = Number(dir);
  if (pid === me || pid === parent) continue;

  let cmd = "";
  try {
    cmd = fs.readFileSync(`/proc/${dir}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    continue;
  }
  if (!cmd) continue;
  // Never touch a shell (our own wrapper) — only real node processes.
  if (cmd.startsWith("bash") || cmd.startsWith("sh ")) continue;
  if (!cmd.includes("node")) continue;

  if (NEEDLES.some((n) => cmd.includes(n))) {
    try {
      process.kill(pid, "SIGTERM");
      killed.push(`${pid}: ${cmd.slice(0, 80)}`);
    } catch {
      /* already gone */
    }
  }
}

console.log(killed.length ? killed.join("\n") : "no next processes found");
