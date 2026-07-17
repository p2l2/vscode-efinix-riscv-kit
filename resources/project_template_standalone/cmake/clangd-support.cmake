set(CMAKE_EXPORT_COMPILE_COMMANDS True)

# Explicitely add implicit include paths
# Fixes clangd, as clangd does not correctly find Efinix gcc include paths
foreach(dir IN LISTS CMAKE_CXX_IMPLICIT_INCLUDE_DIRECTORIES)
    add_compile_options("$<$<COMPILE_LANGUAGE:CXX>:-isystem${dir}>")
endforeach()
foreach(dir IN LISTS CMAKE_C_IMPLICIT_INCLUDE_DIRECTORIES)
    add_compile_options(PRIVATE "$<$<COMPILE_LANGUAGE:C>:-isystem${dir}>")
endforeach()