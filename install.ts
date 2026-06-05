import { homedir } from "node:os"
import { join } from "node:path"
import { tmpdir, userInfo } from "node:os"

type Editor = import("../jemacs-opentui/src/kernel/editor").Editor

function jemacsHome(): string {
  return process.env.JEMACS_HOME ?? join(homedir(), "programming", "vibe", "jemacs-opentui")
}

async function loadJemacsPlugin(editor: Editor, relativePath: string): Promise<void> {
  const mod = await import(join(jemacsHome(), relativePath))
  if (typeof mod.install !== "function") throw new Error(`missing install() in ${relativePath}`)
  await mod.install(editor)
}

export async function install(editor: Editor): Promise<void> {
  const { setCustom } = await import(join(jemacsHome(), "src/runtime/custom.ts"))
  const { setFaceAttribute } = await import(join(jemacsHome(), "src/runtime/faces.ts"))
  const { enableBuiltinTheme } = await import(join(jemacsHome(), "src/themes/index.ts"))

  const userTemporaryFileDirectory = join(tmpdir(), userInfo().username)
  setCustom("backup-directory-alist", [[".", userTemporaryFileDirectory]])

  const gruvbox = await import(join(jemacsHome(), "plugins/gruvbox-dark-hard.ts"))
  gruvbox.install(editor)
  enableBuiltinTheme(gruvbox.gruvboxDarkHardTheme.name)
  setFaceAttribute("default", "family", "Fira Code")
  setFaceAttribute("default", "height", 140)
  editor.setTheme(gruvbox.gruvboxDarkHardTheme)

  await loadJemacsPlugin(editor, "plugins/vertico.ts")
  await loadJemacsPlugin(editor, "plugins/window.ts")
  await loadJemacsPlugin(editor, "plugins/tiling.ts")

  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")

  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("s-f", "counsel-ag")
  editor.key("s-=", "text-scale-adjust")

  await loadPackages(editor)
}

async function loadPackages(editor: Editor): Promise<void> {
  const packagesDir = join(homedir(), ".jemacs", "packages")
  const { readdir } = await import("node:fs/promises")
  let entries: string[]
  try {
    entries = await readdir(packagesDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue
    const path = join(packagesDir, name, "index.ts")
    try {
      const mod = await import(path)
      if (typeof mod.install === "function") await mod.install(editor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
      throw error
    }
  }
}
