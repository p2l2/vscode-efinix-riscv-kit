# A Makefile for building a cmake based project easier.
# Included here for convenience. Configuration is driven by CMake presets
# (CMakePresets.json + machine-specific CMakeUserPresets.json).
EXEC_NAME ?= bringup_10gbe.elf

all: debug

clean:
	rm -rf debug release

debug/Makefile:
	cmake --preset debug

release/Makefile:
	cmake --preset release

debug: debug/Makefile
	${MAKE} -C debug/
	ln -sf debug/${EXEC_NAME} .

release: release/Makefile
	${MAKE} -C release/
	ln -sf debug/${EXEC_NAME} .

# Debug/flash helpers are now defined as CMake targets (see CMakeLists.txt).
# These recipes just forward to them in the debug build tree.
openocd co_debug_register co_debug_deregister gdb gdb_attach: debug/Makefile
	cmake --build debug --target $@

co_debug_gdb: co_debug_register gdb co_debug_deregister

.PHONY: all clean release debug openocd co_debug_register co_debug_deregister co_debug_gdb gdb gdb_attach
