# RISC-V cross-compilation toolchain for Efinix Sapphire SoC bare-metal firmware.
#
# The compiler is located from TOOLCHAIN_DIR (supplied via a CMake preset /
# cache variable, see CMakeUserPresets.json). If that is not set, fall back to
# searching the environment for a toolchain on the legacy path.

set(CMAKE_SYSTEM_PROCESSOR ${RISCV_ISA})
set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -march=${CMAKE_SYSTEM_PROCESSOR} -mabi=${RISCV_ABI}" )

if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows")
    set(TOOL_SUFFIX ".exe")
else()
    set(TOOL_SUFFIX "")
endif()

set(CMAKE_SYSTEM_NAME Generic)

set(CMAKE_AR ${CROSS_COMPILE}ar${TOOL_SUFFIX})
set(CMAKE_ASM_COMPILER ${CROSS_COMPILE}gcc${TOOL_SUFFIX})
set(CMAKE_C_COMPILER ${CROSS_COMPILE}gcc${TOOL_SUFFIX})
set(CMAKE_CXX_COMPILER ${CROSS_COMPILE}g++${TOOL_SUFFIX})

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -g" )

set( CMAKE_C_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_CXX_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_ASM_FLAGS "${CMAKE_C_FLAGS}" CACHE STRING "" )
set( CMAKE_EXE_LINKER_FLAGS   "${CMAKE_EXE_LINKER_FLAGS}  -march=${CMAKE_SYSTEM_PROCESSOR}" )
