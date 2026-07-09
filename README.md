# jemacs-stephen-config

Stephen's personal Jemacs configuration. It exports `install(editor)` with the
theme, Vertico, tiling, personal keys, and package loading.

## Install

The config is installed independently of the core and packages, so the three
repositories may be cloned anywhere:

```bash
./scripts/install.sh
```

This creates `~/.jemacs/init.ts` as a symlink to this checkout. The legacy
`scripts/deploy.sh` name remains as an alias, but it no longer pulls or assumes
sibling repositories. When the core is installed, the script also links its
public `@jemacs/core` API into this checkout for type navigation.

Jemacs core is expected at `${XDG_DATA_HOME:-~/.local/share}/jemacs` and user
packages at `~/.jemacs/packages`. Set `JEMACS_HOME`, `JEMACS_INIT_PATH`, or
`JEMACS_PACKAGES` to override those locations for development.

Install the other repositories with their own scripts:

```bash
/path/to/jemacs-core/scripts/install.sh
/path/to/jemacs-packages/scripts/install.sh
```
