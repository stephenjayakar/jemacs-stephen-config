import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { tmpdir, userInfo } from "node:os"

type Editor = import("../jemacs-opentui/src/kernel/editor").Editor

function jemacsHome(): string {
  return process.env.JEMACS_HOME ?? join(homedir(), "programming", "vibe", "jemacs-opentui")
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
    if (name.startsWith(".") || name === "gemini") continue
    const path = join(dir, name, "index.ts")
    if (!existsSync(path)) continue
    const mod = await import(path)
    if (typeof mod.install === "function") await mod.install(editor)
  }
}

export async function install(editor: Editor): Promise<void> {
  // Tree-sitter grammars are opt-in; markdown mode font-lock depends on them.
  await loadJemacsPlugin(editor, "tree-sitter-grammars")

  const { setCustom } = await import(join(jemacsHome(), "src/runtime/custom.ts"))
  const { setFaceAttribute } = await import(join(jemacsHome(), "src/runtime/faces.ts"))
  const { enableBuiltinTheme } = await import(join(jemacsHome(), "src/themes/index.ts"))

  const userTemporaryFileDirectory = join(tmpdir(), userInfo().username)
  setCustom("backup-directory-alist", [[".", userTemporaryFileDirectory]])
  setCustom("markdown-fontify-code-blocks-natively", true)

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

  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("s-f", "counsel-ag")
  editor.key("s-=", "text-scale-adjust")

  await loadPackages(editor)

  loadPackageAsync(editor, "gemini")
}
