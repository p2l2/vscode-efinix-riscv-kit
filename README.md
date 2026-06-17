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
3. Run `efinixRiscvKit: Create Standalone C++ Project` to scaffold a project.
4. Open the project, build it with CMake Tools, then flash and debug from the Run and Debug view.

## Features

### Create Standalon C++ Project

Run the command `efinixRiscvKit: Create Standalone C++ Project` from the command palette (Ctrl + P) to launch a wizard and creates a new Standalone C++ (or C) project for Efinix Sapphire SoC.

The generated project is based on an included [template](resources/project_template_standalone/) and contains the following features:

- Builds using CMake
- Includes VSCode Launch configurations for debugging standalone and via Efinix co-debugging
- Includes a Makefile for driving tasks directly from the commandline or editors other than VSCode

## License

This project uses different licenses for different parts.

- The extension itself (`src/`) is licensed under the Mozilla Public License 2.0 ([LICENSE_MPL](LICENSE_MPL)).
- The project template (`resources/` and any generated files) are licensed under the Zero-Clause BSD license ([LICENSE_RESOURCES](LICENSE_RESOURCES)).

See [LICENSE.md](LICENSE.md) for the full summary.
