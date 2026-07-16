/**
 * electron/main.js — AXON Desktop Shell (macOS + Windows)
 *
 * Spawns the local bridge (librarian.js) and the Next.js UI server as
 * child processes using Electron's bundled Node runtime (no separate
 * Node.js install required on the user's machine), then opens a native
 * window pointed at the local UI. Everything runs on localhost — no
 * data leaves the machine.
 */

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { fork } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BRIDGE_PORT = process.env.PORT || 3000;
const UI_PORT = process.env.UI_PORT || 3001;
const UI_URL = `http://localhost:${UI_PORT}`;

let mainWindow;
let bridgeProcess;
let nextProcess;

function forkNodeScript(scriptPath, args = []) {
  return fork(scriptPath, args, {
    cwd: ROOT,
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    silent: false,
  });
}

function startBridge() {
  bridgeProcess = forkNodeScript(path.join(ROOT, "librarian.js"));
  bridgeProcess.on("exit", (code) => {
    console.log(`[AXON] Bridge process exited (code ${code})`);
  });
}

function startNextServer() {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  nextProcess = forkNodeScript(nextBin, ["start", "-p", String(UI_PORT)]);
  nextProcess.on("exit", (code) => {
    console.log(`[AXON] Next.js process exited (code ${code})`);
  });
}

function waitForUiAndLoad(retriesLeft = 30) {
  const http = require("http");
  http
    .get(UI_URL, () => {
      mainWindow.loadURL(UI_URL);
    })
    .on("error", () => {
      if (retriesLeft <= 0) {
        mainWindow.loadURL(UI_URL); // give up waiting, load anyway
        return;
      }
      setTimeout(() => waitForUiAndLoad(retriesLeft - 1), 500);
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "AXON",
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  waitForUiAndLoad();

  // Open external links (mailto:, http(s):// to non-local hosts) in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(UI_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

function stopChildProcesses() {
  if (bridgeProcess) bridgeProcess.kill();
  if (nextProcess) nextProcess.kill();
}

app.whenReady().then(() => {
  startBridge();
  startNextServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopChildProcesses();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopChildProcesses);
