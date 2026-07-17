# RISC-V cross-compilation toolchain for Efinix Sapphire SoC bare-metal firmware.
#
# The compiler is located from TOOLCHAIN_DIR (supplied via a CMake preset /
# cache variable, see CMakeUserPresets.json). If that is not set, fall back to
# searching the environment for a toolchain on the legacy path.

set(RISCV_GCC_COMPILER "")

# Forward the toolchain dir into try_compile sub-projects, which re-run this
# toolchain file in a fresh scope without the preset's cache variables.
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES TOOLCHAIN_DIR)
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES TARGET_EFX_RV)

# Preferred: full path from the configured Efinity RISC-V toolchain.
if(TOOLCHAIN_DIR AND EXISTS "${TOOLCHAIN_DIR}/bin/riscv-none-elf-gcc")
    set(CROSS_COMPILE "${TOOLCHAIN_DIR}/bin/riscv-none-elf-")
elseif(TOOLCHAIN_DIR AND EXISTS "${TOOLCHAIN_DIR}/bin/riscv-none-embed-gcc")
    set(CROSS_COMPILE "${TOOLCHAIN_DIR}/bin/riscv-none-embed-")
else()
    message(FATAL_ERROR "Could not find riscv toolchain in ${TOOLCHAIN_DIR}. Check configuration in CMakeUserPresets.json")
endif()

message( "RISC-V GCC found: ${RISCV_GCC_COMPILER}")

set(CMAKE_SYSTEM_PROCESSOR $RISCV_ISA)
set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=${CMAKE_SYSTEM_PROCESSOR} -mabi=${RISCV_ABI}" )

set(CMAKE_SYSTEM_NAME Generic)

set(CMAKE_AR ${CROSS_COMPILE}ar)
set(CMAKE_ASM_COMPILER ${CROSS_COMPILE}gcc)
set(CMAKE_C_COMPILER ${CROSS_COMPILE}gcc)
set(CMAKE_CXX_COMPILER ${CROSS_COMPILE}g++)

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -g" )

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_CXX_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_ASM_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_EXE_LINKER_FLAGS   "${CMAKE_EXE_LINKER_FLAGS}  -march=${CMAKE_SYSTEM_PROCESSOR}" )
