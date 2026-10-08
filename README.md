# pins

Claude Code mod: a `/pins` side pane of open decisions, todos and links. Click a decision to quote it into the prompt box.

## Install (in a terminal `claude` session)

```
/plugin install pins --marketplace JonseyFTW/pins
```

Answer `y` to add the marketplace, then pick the user scope. It then loads in desktop Code tab sessions too.

## Update

```
claude plugin marketplace update pins
claude plugin update pins@pins
```

## Develop

Point `CLAUDE_CODE_PLUGIN_DIRS` (in `~/.claude/settings.json` `env`) at this folder, then:

```
claude plugin validate .
claude plugin test .
```
