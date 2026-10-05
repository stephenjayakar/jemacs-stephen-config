import { spawn } from "node:child_process"
import { existsSync, openSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { tmpdir, userInfo } from "node:os"

type Editor = import("@jemacs/core").Editor
type CommandContext = import("@jemacs/core").CommandContext
type SavedKeybind = { sequence: string; command: string; addedAt?: string }

function jemacsHome(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return process.env.JEMACS_HOME ?? join(dataHome, "jemacs")
}

async function loadJemacsPlugin(editor: Editor, plugin: string): Promise<void> {
  const home = jemacsHome()
  const candidates = [
    join(home, "plugins", `${plugin}.ts`),
    join(home, "plugins", plugin, "index.ts"),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    const mod = await import(path)
    if (typeof mod.install !== "function") throw new Error(`missing install() in ${path}`)
    await mod.install(editor)
    return
  }
  throw new Error(`plugin not found: ${plugin}`)
}

function packagesDir(): string {
  return process.env.JEMACS_PACKAGES ?? join(homedir(), ".jemacs", "packages")
}

/** Load a package without blocking editor startup. */
function loadPackageAsync(editor: Editor, name: string, afterInstall?: (editor: Editor) => void): void {
  const path = join(packagesDir(), name, "index.ts")
  if (!existsSync(path)) return
  void import(path)
    .then(async mod => {
      if (typeof mod.install === "function") await mod.install(editor)
      afterInstall?.(editor)
    })
    .catch(error => {
      editor.message(`Failed to load ${name}: ${error instanceof Error ? error.message : String(error)}`)
    })
}

async function loadPackages(editor: Editor): Promise<void> {
  const dir = packagesDir()
  const { readdir } = await import("node:fs/promises")
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".") || name === "gemini" || name === "jagent") continue
    const path = join(dir, name, "index.ts")
    if (!existsSync(path)) continue
    const mod = await import(path)
    if (typeof mod.install === "function") await mod.install(editor)
  }
}

function keybindsFile(): string {
  return resolve(process.env.JEMACS_KEYBINDS_FILE ?? join(homedir(), ".jemacs", "keybinds.json"))
}

async function readSavedKeybinds(): Promise<SavedKeybind[]> {
  const file = keybindsFile()
  if (!existsSync(file)) return []
  const raw = await readFile(file, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is SavedKeybind =>
    typeof entry === "object"
    && entry != null
    && typeof (entry as SavedKeybind).sequence === "string"
    && typeof (entry as SavedKeybind).command === "string")
}

async function saveKeybind(sequence: string, command: string): Promise<void> {
  const file = keybindsFile()
  const entries = await readSavedKeybinds()
  const withoutOld = entries.filter(entry => entry.sequence !== sequence)
  withoutOld.push({ sequence, command, addedAt: new Date().toISOString() })
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(withoutOld, null, 2)}\n`)
}

async function loadSavedKeybinds(editor: Editor): Promise<void> {
  for (const { sequence, command } of await readSavedKeybinds()) {
    if (editor.commands.get(command)) editor.key(sequence, command)
    else editor.message(`Skipping saved key ${sequence}: unknown command ${command}`)
  }
}

function installPersonalCommands(editor: Editor): void {
  const bindKey = async ({ editor, args }: CommandContext) => {
    const sequence = args[0] ?? await editor.readKeySequence("Press key sequence to bind: ")
    if (!sequence) return
    const command = args[1] ?? await editor.completingRead(`Command to bind to '${sequence}': `, {
      collection: editor.commands.names(),
      history: "command",
    })
    if (!command) return
    if (!editor.commands.get(command)) throw new Error(`Not an interactive command: ${command}`)
    editor.key(sequence, command)
    await saveKeybind(sequence, command)
    const file = keybindsFile()
    editor.message(`Bound ${sequence} to ${command} and saved it to ${file}`)
  }
  editor.command("my/bind-key", bindKey, "Interactively bind a key and persist it to the Jemacs keybinds file.")
  editor.command("my/bind", bindKey, "Alias for `my/bind-key`.")
  editor.command("i-bind-key", bindKey, "Alias for `my/bind-key`.")
}

/** Quit (offering to save), then relaunch `jemacs --gui` on the file that was on screen, with a forced GUI rebuild. */
function installRestartCommand(editor: Editor): void {
  editor.command("my/restart-jemacs", async ({ editor }) => {
    const { addHook, removeHook } = await import(join(jemacsHome(), "src/kernel/hooks.ts"))
    // Only the selected window's file comes back, not every open buffer.
    const path = editor.currentBuffer.path
    const reopen = path && existsSync(path) ? [path] : []
    // Spawn from kill-emacs-hook so cancelling the save prompt leaves no relauncher behind.
    const relaunch = () => {
      const log = openSync(join(tmpdir(), "jemacs-restart.log"), "w")
      const env = { ...process.env, JEMACS_GUI_REBUILD: "1" }
      // Inherited from an Electron parent, this would make the new GUI start as plain Node.
      delete env.ELECTRON_RUN_AS_NODE
      // Wait for this process to exit so the new instance doesn't race it for the window
      // and global hotkey; the launcher rebuilds the Electron assets before starting.
      const child = spawn("/bin/sh", ["-c", 'pid=$1 launcher=$2; shift 2; while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done; exec "$launcher" --gui "$@"', "sh", String(process.pid), join(jemacsHome(), "scripts/jemacs"), ...reopen], {
        detached: true,
        stdio: ["ignore", log, log],
        env,
      })
      child.unref()
    }
    addHook("kill-emacs-hook", relaunch)
    try {
      await editor.run("save-buffers-kill-terminal")
    } finally {
      // quit() snapshots the hook list synchronously, so removing it here is safe either way.
      removeHook("kill-emacs-hook", relaunch)
    }
  }, "Quit Jemacs and relaunch it as `jemacs --gui` on the current file, rebuilding the GUI first.")
  editor.key("s-r", "my/restart-jemacs")
}

export async function install(editor: Editor): Promise<void> {
  // Tree-sitter grammars are opt-in; markdown mode font-lock depends on them.
  await loadJemacsPlugin(editor, "tree-sitter-grammars")

  await import(join(jemacsHome(), "plugins/markdown/index.ts"))
  const { setCustom } = await import(join(jemacsHome(), "src/runtime/custom.ts"))
  const { setFaceAttribute } = await import(join(jemacsHome(), "src/runtime/faces.ts"))
  const { enableBuiltinTheme, registerTheme } = await import(join(jemacsHome(), "src/themes/index.ts"))

  const userTemporaryFileDirectory = join(tmpdir(), userInfo().username)
  setCustom("backup-directory-alist", [[".", userTemporaryFileDirectory]])
  setCustom("markdown-fontify-code-blocks-natively", true)
  setCustom("markdown-indent-on-enter", "indent-and-new-item")
  setCustom("markdown-trim-trailing-whitespace-on-enter", true)
  setCustom("lsp-ui-doc-enable", true)
  // find-file matches anywhere in a name: `spire` finds `kanto spire`.
  setCustom("completion-category-overrides", [["file", ["styles", "substring", "basic"]]])
  // Notion-style markdown layout (mirrors ~/.emacs.d/stephen.el markdown-mode-hook).
  setCustom("markdown-fill-column", 100)
  setCustom("markdown-visual-fill-column-center-text", true)
  // Keep the column's pixel width when zooming; bigger text wraps sooner.
  setCustom("markdown-visual-fill-column-adjust-for-text-scale", false)

  const gruvbox = await import(join(jemacsHome(), "plugins/gruvbox-dark-hard.ts"))
  gruvbox.install(editor)
  // Gruvbox dark hard, but with a pitch-black background instead of #1d2021.
  const baseTheme = gruvbox.gruvboxDarkHardTheme
  const theme = registerTheme({
    ...baseTheme,
    faces: { ...baseTheme.faces, default: { ...baseTheme.faces.default, bg: "#000000" } },
  })
  enableBuiltinTheme(theme.name)
  setFaceAttribute("default", "family", "Fira Code")
  setFaceAttribute("default", "height", 140)
  editor.setTheme(theme)

  await loadJemacsPlugin(editor, "vertico")
  await loadJemacsPlugin(editor, "window")
  await loadJemacsPlugin(editor, "tiling")

  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")
  editor.enableMinorMode("global-undo-tree-mode")

  installPersonalCommands(editor)
  installRestartCommand(editor)
  await loadSavedKeybinds(editor)

  editor.key("C-x l", "goto-line")
  editor.key("s-q", "save-buffers-kill-terminal")
  // Cmd -/=/0 like other macOS apps; text-scale-adjust's repeat map would swallow a bare "-".
  editor.command("my/text-scale-reset", ({ editor }) => editor.run("text-scale-set", ["0"]), "Reset buffer text scale.")
  editor.key("s--", "text-scale-decrease")
  editor.key("s-=", "text-scale-increase")
  editor.key("s-+", "text-scale-increase")
  editor.key("s-0", "my/text-scale-reset")
  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("C-x C-j", "previous-buffer")
  editor.key("C-x C-l", "next-buffer")
  editor.key("C-c g s", "magit-status")
  editor.key("s-f", "counsel-ag")
  editor.key("s-=", "text-scale-adjust")

  await loadPackages(editor)

  loadPackageAsync(editor, "gemini")
  loadPackageAsync(editor, "jagent")
}
