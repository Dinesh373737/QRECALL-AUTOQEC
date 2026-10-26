import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
const python =
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python";
if (!existsSync(python)) {
  console.error(
    "Python dependencies are missing. Follow the setup steps in README.md.",
  );
  process.exit(1);
}
const frontendEntry = "node_modules/vite/bin/vite.js";
if (!existsSync(frontendEntry)) {
  console.error(
    "Frontend dependencies are missing. Run npm ci before starting the demo.",
  );
  process.exit(1);
}
async function available(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error.code));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(null)));
  });
}
for (const port of [8000, 5173]) {
  const code = await available(port);
  if (code) {
    console.error(
      code === "EADDRINUSE"
        ? `Port ${port} is already in use. Stop the existing demo or the application using that port.`
        : `This environment cannot open local port ${port} (${code}). Run the demo in a terminal that permits local servers.`,
    );
    process.exit(1);
  }
}
const children = [];
let exiting = false;
function stop(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}
function launch(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code || 0));
  return child;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log("Starting the QRecall AutoQEC scientific engine…");
launch(python, [
  "-m",
  "uvicorn",
  "backend.main:app",
  "--host",
  "127.0.0.1",
  "--port",
  "8000",
]);
let ready = false;
const readinessDeadline = Date.now() + 150_000;
let lastNotice = Date.now();
while (Date.now() < readinessDeadline && !exiting) {
  try {
    const response = await fetch("http://127.0.0.1:8000/api/health", {
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(700, readinessDeadline - Date.now())),
      ),
    });
    const health = response.ok ? await response.json() : null;
    if (health?.status === "ok" && health.schema_version === "1.0") {
      ready = true;
      break;
    }
  } catch {}
  if (Date.now() - lastNotice > 10_000) {
    lastNotice = Date.now();
    console.log("Still loading the scientific libraries (Qiskit, Stim, PyMatching)…");
  }
  if (!exiting && Date.now() < readinessDeadline)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(300, readinessDeadline - Date.now())),
    );
}
if (!ready) {
  console.error(
    "The scientific engine did not start within 150 seconds. Review the error above, then try again.",
  );
  stop(1);
} else if (!exiting)
  launch(process.execPath, [frontendEntry, "--host", "127.0.0.1"]);
