# Preview debug markdown

Untracked-turned-tracked scratch file for checking the Jarvis README/markdown renderer end to end: headings, emphasis, links, code, and an inline image.

## Formatting

Some **bold** text, some *italic* text, and a [link to example.com](https://example.com).

## Code block

```bash
echo "rendered by marked"
```

## Inline image (relative path, should load)

![Working test image](preview-debug.png)

## Table

| Check | Expected |
|---|---|
| Heading | Renders as `<h1>`/`<h2>` |
| Image above | Loads a tiny real PNG |
| This table | Renders as a bordered table |
