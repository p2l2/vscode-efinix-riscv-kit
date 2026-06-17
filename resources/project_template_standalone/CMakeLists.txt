cmake_minimum_required(VERSION 4.0.0)

project(__PROJECT_NAME__ CXX C ASM)

set(LINKER_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/ld/dram.ld")
set(EFX_BSP "__BSP_DIR__")

message("Compiling for BSP directory ${EFX_BSP}")

add_executable(${PROJECT_NAME}
    ${EFX_BSP}/software/standalone/common/trap.S
    ${EFX_BSP}/software/standalone/common/start.S
    src/main.cpp
)

target_include_directories(${PROJECT_NAME} PUBLIC
    ${EFX_BSP}/bsp/efinix/EfxSapphireSoc/include
    ${EFX_BSP}/software/standalone/driver/
)

# Explicitely add implicit include paths
# Fixes clangd, as clangd does not correctly find Efinix gcc include paths
foreach(dir IN LISTS CMAKE_CXX_IMPLICIT_INCLUDE_DIRECTORIES)
    target_compile_options(${PROJECT_NAME} PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:-isystem${dir}>")
endforeach()
foreach(dir IN LISTS CMAKE_C_IMPLICIT_INCLUDE_DIRECTORIES)
    target_compile_options(${PROJECT_NAME} PRIVATE "$<$<COMPILE_LANGUAGE:C>:-isystem${dir}>")
endforeach()

target_link_options(${PROJECT_NAME} PRIVATE "-T${LINKER_SCRIPT}" "-nostartfiles")

# ---------------------------------------------------------------------------
# Debug / flash helper targets for working on the command line
# Invoke explicitly, e.g.:
#   cmake --build debug --target openocd
#   cmake --build debug --target gdb
# ---------------------------------------------------------------------------

# Machine-specific Efinity tool paths come from a CMake preset (see
# CMakeUserPresets.json) as cache variables. They are only required by the helper
# targets below;
foreach(_efx_var OPENOCD TOOLCHAIN_DIR EFINITY_INSTALL_DIR)
    if(NOT ${_efx_var})
        message(WARNING "${_efx_var} is not set — debug/flash helper targets will "
            "not work. Set it in CMakeUserPresets.json (see README).")
    endif()
endforeach()

# EFX_BSP is relative to the source dir; make it absolute because custom
# targets run from the build dir, not the source root.
get_filename_component(EFX_BSP_ABS "${EFX_BSP}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

set(RISCV_GDB   "${TOOLCHAIN_DIR}/bin/riscv-none-elf-gdb")
set(JTAG_DAEMON "${EFINITY_INSTALL_DIR}/debugger/bin/jtag_daemon_cmd.sh")
set(OCD_DIR     "${EFX_BSP_ABS}/bsp/efinix/EfxSapphireSoc/openocd")

add_custom_target(openocd
    COMMAND ${OPENOCD} -f ${OCD_DIR}/ftdi_ti.cfg -f ${OCD_DIR}/debug_ti.cfg
    USES_TERMINAL VERBATIM)

add_custom_target(gdb
    COMMAND ${RISCV_GDB} $<TARGET_FILE:${PROJECT_NAME}>
            -ex "target extended-remote localhost:3333"
            -ex "monitor reset halt" -ex "load" -ex "set $pc=_start"
    USES_TERMINAL VERBATIM)

add_custom_target(gdb_attach
    COMMAND ${RISCV_GDB} $<TARGET_FILE:${PROJECT_NAME}>
            -ex "target extended-remote localhost:3333"
    USES_TERMINAL VERBATIM)

add_custom_target(co_debug_register
    COMMAND ${JTAG_DAEMON} --register_id MakefileDebug --auto_select
            --chain_tap "1,tap1,5" --gdb_port 3333 --jtag_khz 3000 --debug
            --cfg_file ${OCD_DIR}/co_debug/co_debug.cfg
    USES_TERMINAL VERBATIM)

add_custom_target(co_debug_deregister
    COMMAND ${JTAG_DAEMON} --unregister_id MakefileDebug
    USES_TERMINAL VERBATIM)
