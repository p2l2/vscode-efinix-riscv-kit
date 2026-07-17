cmake_minimum_required(VERSION 4.0.0)

project(edge_brain_commtest CXX C ASM)

set(LINKER_SCRIPT "${CMAKE_CURRENT_SOURCE_DIR}/ld/dram.ld")
message("Compiling for BSP directory ${EFX_BSP}")

add_executable(${PROJECT_NAME})

# Uncomment the correct code model from the lines below

# target_compile_options(${PROJECT_NAME} PUBLIC "-mcmodel=medlow") # All addresses <= 2GiB
target_compile_options(${PROJECT_NAME} PUBLIC "-mcmodel=medany")   # Arbitrary addresses, firmware size <= 2GiB
# target_compile_options(${PROJECT_NAME} PUBLIC "-mcmodel=large")  # Full 64-bit addresses, only for RV64

# Enable multi-core support in efinix startup code

# If you want to build a bootloader or very small freestanding application
# Will not call any libc initialization, unsafe to use with C++
set(NOSTD False)

target_sources(${PROJECT_NAME} PUBLIC
    ${EFX_BSP}/software/standalone/common/start.S
    src/main.cpp
)

if (RISCV_ISA MATCHES "^rv64")
    set(EFX_BSP_INC_DIR "${EFX_BSP}/bsp/efinix/EfxSapphireSocRV64/include")
else()
    set(EFX_BSP_INC_DIR "${EFX_BSP}/bsp/efinix/EfxSapphireSoc/include")
endif()


target_include_directories(${PROJECT_NAME} PUBLIC
    src/
    ${EFX_BSP_INC_DIR}
    ${EFX_BSP}/software/standalone/driver/
    ${EFX_BSP}/software/standalone/common/
)
# Build .bin file for use in efinity image combiner
add_custom_command(
    TARGET ${PROJECT_NAME}
    POST_BUILD
    COMMAND "${CMAKE_OBJCOPY}" ARGS -O binary "${PROJECT_NAME}" "${PROJECT_NAME}.bin"
)

# Selects linkerscript, -nostartfiles as we provide our own start.S
target_link_options(${PROJECT_NAME} PRIVATE "-T${LINKER_SCRIPT}" "-nostartfiles")

if(NOSTD)
    target_compile_definitions(${PROJECT_NAME} PUBLIC "NO_LIBC_INIT_ARRAY")
    target_link_options(${PROJECT_NAME} PUBLIC "-nostdlib")
else()
    target_link_options(${PROJECT_NAME} PUBLIC "--specs=nano.specs" "--specs=nosys.specs")
endif()

if(SMP)
    target_compile_definitions(${PROJECT_NAME} PUBLIC SMP)
endif()

include(cmake/clangd-support.cmake)
include(cmake/debug-targets.cmake)