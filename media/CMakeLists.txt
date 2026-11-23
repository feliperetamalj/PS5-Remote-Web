cmake_minimum_required(VERSION 3.20)
project(ps5-media C CXX)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

# libchiaki sola: sin interfaz, sin CLI, sin decodificador (el video se reenvía tal cual).
set(CHIAKI_ENABLE_GUI OFF CACHE BOOL "" FORCE)
set(CHIAKI_ENABLE_CLI OFF CACHE BOOL "" FORCE)
set(CHIAKI_ENABLE_TESTS OFF CACHE BOOL "" FORCE)
set(CHIAKI_ENABLE_FFMPEG_DECODER OFF CACHE BOOL "" FORCE)
set(CHIAKI_ENABLE_STEAMDECK_NATIVE OFF CACHE BOOL "" FORCE)
set(CHIAKI_ENABLE_STEAM_SHORTCUT OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/chiaki-ng EXCLUDE_FROM_ALL)

# libdatachannel estática, solo transporte de medios y DataChannel.
set(NO_WEBSOCKET ON CACHE BOOL "" FORCE)
set(NO_EXAMPLES ON CACHE BOOL "" FORCE)
set(NO_TESTS ON CACHE BOOL "" FORCE)
add_subdirectory(third_party/libdatachannel EXCLUDE_FROM_ALL)

add_executable(media src/main.c src/server.cpp)
target_include_directories(media PRIVATE third_party/libdatachannel/deps/json/include)
target_link_libraries(media chiaki-lib datachannel-static)
