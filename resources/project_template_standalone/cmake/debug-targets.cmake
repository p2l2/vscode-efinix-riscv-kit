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

if (EXISTS "${EFX_BSP_ABS}/bsp/efinix/EfxSapphireSocRV64/openocd")
    # dir name changed for RV64
    set(OCD_DIR     "${EFX_BSP_ABS}/bsp/efinix/EfxSapphireSocRV64/openocd")
else()
    set(OCD_DIR     "${EFX_BSP_ABS}/bsp/efinix/EfxSapphireSoc/openocd")
endif()

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
    COMMAND ${JTAG_DAEMON} --register_id  "p2l2.efinixRiscvKit" --auto_select
            --chain_tap "1,tap1,5" --gdb_port 3333 --jtag_khz 3000 --debug
            --jtag_channel_no 1
            --cfg_file ${OCD_DIR}/co_debug/co_debug.cfg
    USES_TERMINAL VERBATIM)
 
add_custom_target(co_debug_deregister
    COMMAND ${JTAG_DAEMON} --unregister_id  "p2l2.efinixRiscvKit"
    USES_TERMINAL VERBATIM)
