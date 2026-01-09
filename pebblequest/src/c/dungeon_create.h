#pragma once
#include <pebble.h>

#define DUNGEON_W 21
#define DUNGEON_H 21
#define CELL_PATH 0
#define CELL_WALL 1

void dungeon_create(uint8_t dungeon[DUNGEON_H][DUNGEON_W]);