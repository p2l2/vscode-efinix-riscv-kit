# RISC-V cross-compilation toolchain for Efinix Sapphire SoC bare-metal firmware.
#
# The compiler is located from TOOLCHAIN_DIR (supplied via a CMake preset /
# cache variable, see CMakeUserPresets.json). If that is not set, fall back to
# searching the environment for a toolchain on the legacy path.

set(RISCV_GCC_COMPILER "")

# Forward the toolchain dir into try_compile sub-projects, which re-run this
# toolchain file in a fresh scope without the preset's cache variables.
list(APPEND CMAKE_TRY_COMPILE_PLATFORM_VARIABLES TOOLCHAIN_DIR)

# Preferred: full path from the configured Efinity RISC-V toolchain.
if(TOOLCHAIN_DIR AND EXISTS "${TOOLCHAIN_DIR}/bin/riscv-none-elf-gcc")
    set(RISCV_GCC_COMPILER "${TOOLCHAIN_DIR}/bin/riscv-none-elf-gcc")
endif()

# Fallback: search the environment (legacy behaviour, requires the toolchain
# to be reachable via the INCLUDE/PATH environment).
if(NOT RISCV_GCC_COMPILER)
    # xpack: https://xpack.github.io/riscv-none-embed-gcc/
    FIND_FILE( RISCV_XPACK_GCC_COMPILER_EXE "riscv-none-embed-gcc.exe" PATHS ENV INCLUDE)
    FIND_FILE( RISCV_XPACK_GCC_COMPILER "riscv-none-embed-gcc" PATHS ENV INCLUDE)
    # New versions of xpack
    FIND_FILE( RISCV_XPACK_NEW_GCC_COMPILER_EXE "riscv-none-elf-gcc.exe" PATHS ENV INCLUDE)
    FIND_FILE( RISCV_XPACK_NEW_GCC_COMPILER "riscv-none-elf-gcc" PATHS ENV INCLUDE)
    # RISC-V github GCC: https://github.com/riscv/riscv-gnu-toolchain
    FIND_FILE( RISCV_XPACK_GCC_COMPILER_EXT "riscv32-unknown-elf-gcc.exe" PATHS ENV INCLUDE)
    FIND_FILE( RISCV_XPACK_GCC_COMPILER "riscv32-unknown-elf-gcc" PATHS ENV INCLUDE)

    if (EXISTS ${RISCV_XPACK_NEW_GCC_COMPILER})
        set( RISCV_GCC_COMPILER ${RISCV_XPACK_NEW_GCC_COMPILER})
    elseif (EXISTS ${RISCV_XPACK_GCC_NEW_COMPILER_EXE})
        set( RISCV_GCC_COMPILER ${RISCV_XPACK_NEW_GCC_COMPILER_EXE})
    elseif (EXISTS ${RISCV_XPACK_GCC_COMPILER})
        set( RISCV_GCC_COMPILER ${RISCV_XPACK_GCC_COMPILER})
    elseif (EXISTS ${RISCV_XPACK_GCC_COMPILER_EXE})
        set( RISCV_GCC_COMPILER ${RISCV_XPACK_GCC_COMPILER_EXE})
    else()
        message(FATAL_ERROR "RISC-V GCC not found. Set TOOLCHAIN_DIR "
            "in CMakeUserPresets.json, or put the toolchain on the environment.")
    endif()
endif()

message( "RISC-V GCC found: ${RISCV_GCC_COMPILER}")

get_filename_component(RISCV_TOOLCHAIN_BIN_PATH ${RISCV_GCC_COMPILER} DIRECTORY)
get_filename_component(RISCV_TOOLCHAIN_BIN_GCC ${RISCV_GCC_COMPILER} NAME_WE)

message( "RISC-V GCC Path: ${RISCV_TOOLCHAIN_BIN_PATH}" )

# Build the cross-compile prefix, including the full toolchain bin path so the
# compilers resolve without relying on PATH.
STRING(REGEX REPLACE "\-gcc" "-" CROSS_COMPILE ${RISCV_TOOLCHAIN_BIN_GCC})
set(CROSS_COMPILE "${RISCV_TOOLCHAIN_BIN_PATH}/${CROSS_COMPILE}")
message( "RISC-V Cross Compile: ${CROSS_COMPILE}" )

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR rv32imafdc)

set(CMAKE_AR ${CROSS_COMPILE}ar)
set(CMAKE_ASM_COMPILER ${CROSS_COMPILE}gcc)
set(CMAKE_C_COMPILER ${CROSS_COMPILE}gcc)
set(CMAKE_CXX_COMPILER ${CROSS_COMPILE}g++)

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -g" )
set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=${CMAKE_SYSTEM_PROCESSOR} -mabi=ilp32d" )

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_CXX_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_ASM_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_EXE_LINKER_FLAGS   "${CMAKE_EXE_LINKER_FLAGS}  -march=${CMAKE_SYSTEM_PROCESSOR}    -nostartfiles   " )
