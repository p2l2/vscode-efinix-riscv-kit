# A Makefile for building a cmake based project easier.
# Included here for convenience
DEBUG_BUILD_TYPE ?= Debug
REL_BUILD_TYPE ?= RelWithDebInfo
EXEC_NAME ?= __PROJECT_NAME__.elf
EFX_BSP ?= ../../fpga/prjMIPI2RoCE/src/grpTopLevel/unitOnTi375N1156_devkit/embedded_sw/efx_hard_soc

-include settings.make

ifndef EFINITY_RISCV_INSTALL_DIR
$(error EFINITY_RISCV_INSTALL_DIR is not set. Check the README!)
endif
ifndef EFINITY_INSTALL_DIR
$(error EFINITY_INSTALL_DIR is not set. Check the README!)
endif

all: debug

clean:
	rm -rf debug release

debug/Makefile:
	mkdir -p debug
	cd debug && cmake .. -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=${DEBUG_BUILD_TYPE} -DCMAKE_TOOLCHAIN_FILE=./cmake/risc-efinix.cmake

release/Makefile:
	mkdir -p release
	cd release && cmake .. -G "Unix Makefiles" -DCMAKE_BUILD_TYPE=${REL_BUILD_TYPE} -DCMAKE_TOOLCHAIN_FILE=./cmake/risc-efinix.cmake

debug: debug/Makefile
	${MAKE} -C debug/
	ln -sf debug/${EXEC_NAME} .

release: release/Makefile
	${MAKE} -C release/
	ln -sf debug/${EXEC_NAME} .

openocd: 
	${EFINITY_RISCV_INSTALL_DIR}/openocd/bin/openocd -f ${EFX_BSP}/bsp/efinix/EfxSapphireSoc/openocd/ftdi_ti.cfg -f ${EFX_BSP}/bsp/efinix/EfxSapphireSoc/openocd/debug_ti.cfg

co_debug_register:
	${EFINITY_INSTALL_DIR}/debugger/bin/jtag_daemon_cmd.sh --register_id MakefileDebug --auto_select --chain_tap "1,tap1,5" --gdb_port 3333 --jtag_khz 3000 --debug --cfg_file ${EFX_BSP}/bsp/efinix/EfxSapphireSoc/openocd/co_debug/co_debug.cfg

co_debug_deregister:
	${EFINITY_INSTALL_DIR}/debugger/bin/jtag_daemon_cmd.sh --unregister_id MakefileDebug

gdb:
	${EFINITY_RISCV_INSTALL_DIR}/toolchain/bin/riscv-none-elf-gdb ${EXEC_NAME} -ex "target extended-remote localhost:3333" -ex "monitor reset halt" -ex "load"  -ex 'set $$pc=_start'

gdb_attach:
	${EFINITY_RISCV_INSTALL_DIR}/toolchain/bin/riscv-none-elf-gdb ${EXEC_NAME} -ex "target extended-remote localhost:3333"

co_debug_gdb: co_debug_register gdb co_debug_deregister

.PHONY: all clean release debug openocd co_debug_register co_debug_deregister co_debug_gdb gdb gdb_attach
