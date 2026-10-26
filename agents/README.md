# Agents

Agents created in the Kushex panel (**Agents** activity) are stored here, one
folder per agent:

```
agents/
  code-reviewer/
    agent.ts            # primary file: `export default agent`
    prompts/review.ts   # any other files the agent needs
```

The primary file is written against [kushibot](../../kushibot) and starts from a
template that defines the agent's instructions, model profile and run
configuration, exported together as the default export. The panel shows the
whole folder as a tree: every text file can be edited and saved, new files and
subfolders can be added, and imports between the agent's files are type-checked.
Hidden files (names starting with a dot) and symlinks are not shown; binary files
and files over 512 KB are listed but cannot be edited.

The server reads and writes this directory (`KUSHEX_AGENTS_DIR`, default: this
folder). Saving from the panel is revision-checked: if the file changed after you
opened it, the save is rejected instead of overwriting the newer version. Each
file is checked on its own. Files
can also be edited here directly; reopen the agent in the panel afterwards.
