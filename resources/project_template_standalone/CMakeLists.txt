cmake_minimum_required(VERSION 4.0.0)

project(__PROJECT_NAME__.elf CXX C ASM)

set(LINKER_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/ld/dram.ld")
set(EFX_BSP __BSP_DIR__)

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

