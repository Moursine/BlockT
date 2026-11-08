# BlockT

BlockT is a Windows desktop automation app. Build flows with visual blocks, then run actions such as opening programs, typing, pressing keys, moving or clicking the mouse, waiting for conditions, and restricting actions to a selected active application.

Website: https://blockt.moursine.com/

## Download

Download the latest installer from the [Releases page](https://github.com/Moursine/BlockT/releases/latest), then run `BlockT Setup <version>.exe`.

## Requirements

- Windows 10 or later

## Build From Source

Requires Node.js 20 or later and npm 10 or later.

```powershell
cd src
npm ci
npm start
```

To build the Windows installer:

```powershell
npm run dist
```

The installer is created in `src/dist/`.

## Variables

- `Set variable`: `a = 3`
- `Random variable`: `roll = 1 to 6` (either end can be another variable)
- `Change variable`: `a + 1`, `a - b`, or `a + 1 to 5` for a random amount
- `Wait` and `Repeat` accept a variable: `a`, `"a" second`, `a times`

## Project Structure

```text
src/
  app.js             Renderer logic and visual flow editor
  main.js            Electron main process and Windows automation
  preload.js         Context-isolated IPC bridge
  index.html         Application shell
  styles.css         Base application styles
  event-block.css    Block-editor styles
  assets/            Application assets
download/            Download instructions
```
