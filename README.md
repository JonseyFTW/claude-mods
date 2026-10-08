# claude-mods

Claude Code mods, one folder each. The repo is a plugin marketplace (`jonsey-mods`); install only the mods you want.

| Mod | What it does |
| --- | --- |
| `pins` | `/pins` side pane of open decisions, todos and links. Click a decision to quote it into the prompt box. |
| `cache-meter` | Band above the prompt showing whether the prompt cache is warm, time left, and last turn's hit rate. |

## Install (in a terminal `claude` session)

```
/plugin marketplace add JonseyFTW/claude-mods
/plugin install pins@jonsey-mods
/plugin install cache-meter@jonsey-mods
```

Pick the user scope. Installed mods load in desktop Code tab sessions too.

## Update

```
claude plugin marketplace update jonsey-mods
claude plugin update pins@jonsey-mods
claude plugin update cache-meter@jonsey-mods
```

Then start a new session.

## Develop (main PC)

This folder is added as a local marketplace (`claude plugin marketplace add <this folder>`), so installed mods are read straight from it. After editing, run `/reload-plugins`.

```
claude plugin validate <mod folder>
claude plugin test <mod folder>
```

Adding a mod: create `<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, then add it to `.claude-plugin/marketplace.json`.
