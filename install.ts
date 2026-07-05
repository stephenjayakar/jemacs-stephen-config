import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { tmpdir, userInfo } from "node:os"

type Editor = import("../jemacs-opentui/src/kernel/editor").Editor
type CommandContext = import("../jemacs-opentui/src/kernel/command").CommandContext
type SavedKeybind = { sequence: string; command: string; addedAt?: string }

function jemacsHome(): string {
  return process.env.JEMACS_HOME ?? join(dirname(fileURLToPath(import.meta.url)), "..", "jemacs-opentui")
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

export async function install(editor: Editor): Promise<void> {
  // Tree-sitter grammars are opt-in; markdown mode font-lock depends on them.
  await loadJemacsPlugin(editor, "tree-sitter-grammars")

  await import(join(jemacsHome(), "plugins/markdown/index.ts"))
  const { setCustom } = await import(join(jemacsHome(), "src/runtime/custom.ts"))
  const { setFaceAttribute } = await import(join(jemacsHome(), "src/runtime/faces.ts"))
  const { enableBuiltinTheme } = await import(join(jemacsHome(), "src/themes/index.ts"))

  const userTemporaryFileDirectory = join(tmpdir(), userInfo().username)
  setCustom("backup-directory-alist", [[".", userTemporaryFileDirectory]])
  setCustom("markdown-fontify-code-blocks-natively", true)
  setCustom("lsp-ui-doc-enable", true)
  // Notion-style markdown layout (mirrors ~/.emacs.d/stephen.el markdown-mode-hook).
  setCustom("markdown-fill-column", 100)
  setCustom("markdown-visual-fill-column-center-text", true)

  const gruvbox = await import(join(jemacsHome(), "plugins/gruvbox-dark-hard.ts"))
  gruvbox.install(editor)
  enableBuiltinTheme(gruvbox.gruvboxDarkHardTheme.name)
  setFaceAttribute("default", "family", "Fira Code")
  setFaceAttribute("default", "height", 140)
  editor.setTheme(gruvbox.gruvboxDarkHardTheme)

  await loadJemacsPlugin(editor, "vertico")
  await loadJemacsPlugin(editor, "window")
  await loadJemacsPlugin(editor, "tiling")

  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")
  editor.enableMinorMode("global-undo-tree-mode")

  installPersonalCommands(editor)
  await loadSavedKeybinds(editor)

  editor.key("C-x l", "goto-line")
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
