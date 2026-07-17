# Efinix RISC-V Devkit

Development tools for the RISC-V (Sapphire SoC) cores on Efinix FPGAs. It scaffolds ready-to-build C++ projects wired up for building, flashing, and debugging via CMake and OpenOCD.

## Requirements

- The [Efinity](https://www.efinixinc.com/products-efinity.html) Software
    - Required to support co-debugging
- The [Efinity RISC-V IDE](https://www.efinixinc.com/products-efinity-riscv-ide.html)
    - Alternatively, an X-Pack RV32 toolchain and an openocd installation, that supports VexRiscV
- The Efinix RISC-V BSP (Sapphire SoC board support package) for your design.

## Getting Started

1. Open Settings, search for `efinixRiscvKit`, and set:
   - `efinityPath` — the Efinity IDE install directory (contains `debugger/`).
   - `efinityToolchainPath` — the RISC-V toolchain root (contains `bin/riscv-none-elf-gcc`).
   - `openocdPath` — path to `openocd`, or just `openocd` if it's on your `PATH` (default).
2. Run `efinixRiscvKit: Validate Configuration` to check the paths.
3. Run `efinixRiscvKit: Create Project` to scaffold a project.
4. Open the project, build it with CMake Tools, then flash and debug from the Run and Debug view.

## Features

### Create Project

Run the command `efinixRiscvKit: Create Project` from the command palette (Ctrl + P) to launch a wizard that scaffolds a new project. When more than one template is available (see [Custom Templates](#custom-templates)), the wizard first asks which one to use; otherwise it goes straight to the included Standalone C++ template.

The included [Standalone C++ template](resources/project_template_standalone/) creates a Standalone C++ (or C) project for Efinix Sapphire SoC and contains the following features:

- Builds using CMake
- Includes VSCode Launch configurations for debugging standalone and via Efinix co-debugging
- Includes a Makefile for driving tasks directly from the commandline or editors other than VSCode

### Custom Templates

You can register your own project templates alongside the included one. Point the `efinixRiscvKit.customTemplatePaths` setting at one or more directories. Each entry is either a template directory (one containing an `efinix-template.json` manifest) or a folder holding several such template directories.

Paths may be absolute, start with `~`, or be relative. A relative path (e.g. `./templates/my-template`) is resolved against the directory of the `.code-workspace` file (when a saved workspace is open) and against each open workspace folder, so you can check a template into a workspace and reference it from the workspace's settings without hard-coding an absolute path.

A template is any directory with an `efinix-template.json` manifest at its root plus the files to scaffold:

```jsonc
{
  "id": "my-template",                 // optional, defaults to the folder name; recorded in the project marker
  "name": "My Template",               // shown in the template picker
  "description": "What this template is for",
  "requiresBsp": true,                 // add the Efinix BSP wizard step and the __BSP_DIR__ token
  "requiresToolPaths": true,           // require the configured Efinity tool paths and provide their tokens
  "variables": [                       // optional extra prompts, each asked in the wizard
    {
      "name": "AUTHOR",                // referenced in files as __AUTHOR__ (must match [A-Z0-9_]+)
      "prompt": "Author name",         // shown as the input prompt
      "description": "Used in file headers",
      "default": "",
      "kind": "text"                   // "text" or "path" ("path" adds a Browse button)
    }
  ]
}
```

When a project is created, every file in the template is copied over and the following placeholder tokens are substituted (the manifest itself is not copied):

- `__PROJECT_NAME__` — the project name entered in the wizard
- `__BSP_DIR__` — path to the selected BSP, relative to the project (only when `requiresBsp` is set)
- `__OPENOCD_PATH__`, `__TOOLCHAIN_PATH__`, `__EFINITY_PATH__` — the configured tool paths (only when `requiresToolPaths` is set)
- `__NAME__` — one token per custom variable declared in `variables`

Set `requiresBsp` and `requiresToolPaths` to `false` for templates that don't target the Sapphire SoC — the wizard then skips the BSP step and the tool-path check. The included [Standalone C++ template](resources/project_template_standalone/) is a full working example.

## License

This project uses different licenses for different parts.

- The extension itself (`src/`) is licensed under the Mozilla Public License 2.0 ([LICENSE_MPL](LICENSE_MPL)).
- The project template (`resources/` and any generated files) are licensed under the Zero-Clause BSD license ([LICENSE_RESOURCES](LICENSE_RESOURCES)).

See [LICENSE.md](LICENSE.md) for the full summary.
