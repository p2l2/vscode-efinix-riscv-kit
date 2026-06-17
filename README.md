# Efinix RISC-V Devkit

Development tools for the RISC-V (Sapphire SoC) cores on Efinix FPGAs. It scaffolds ready-to-build C++ projects wired up for building, flashing, and debugging via CMake and OpenOCD.

## Requirements

- The [Efinity IDE](https://www.efinixinc.com/products-efinity.html), including its bundled RISC-V GCC toolchain and OpenOCD. This extension drives that toolchain; it does not install one.
- An Efinix RISC-V BSP (Sapphire SoC board support package) for your design.
- The CMake Tools and Cortex-Debug extensions, installed automatically as dependencies.

## Getting Started

1. Open Settings, search for `efinixRiscvKit`, and set:
   - `efinityPath` — the Efinity IDE install directory (contains `debugger/`).
   - `efinityToolchainPath` — the RISC-V toolchain root (contains `bin/riscv-none-elf-gcc`).
   - `openocdPath` — path to `openocd`, or just `openocd` if it's on your `PATH` (default).
2. Run `efinixRiscvKit: Validate Configuration` to check the paths.
3. Run `efinixRiscvKit: Create Standalone C++ Project` to scaffold a project.
4. Open the project, build it with CMake Tools, then flash and debug from the Run and Debug view.

## Features

`efinixRiscvKit: Create Standalone C++ Project` — a wizard that prompts for a project name, base directory, and a (validated) Efinix BSP, then scaffolds a complete project: CMake presets, a Makefile, linker scripts, and `.vscode` build/debug configs, all pre-filled with your toolchain paths and BSP. Builds with CMake Tools or `make`, and supports both direct OpenOCD debugging and Efinity co-debugging. The last-used BSP is remembered as the default.

`efinixRiscvKit: Validate Configuration` — checks that the Efinity, toolchain, and OpenOCD paths are set and valid.

## License

Two licenses, split by what the code is:

- The extension itself (`src/`) is under the Mozilla Public License 2.0 ([LICENSE_MPL](LICENSE_MPL)) — a file-level copyleft. If you distribute a modified version, your changes to the original MPL files must stay MPL (or a compatible license like GPL 2.0+) with copyright notices intact; new files you add can be any license.
- The project template and anything the wizard generates (`resources/` and the files written into your project) are under the Zero-Clause BSD license ([LICENSE_RESOURCES](LICENSE_RESOURCES)) — effectively public-domain, with no attribution or copyleft obligations.

So the scaffolding tooling is copyleft, but the code it scaffolds for you has no strings attached. See [LICENSE.md](LICENSE.md) for the full summary.
