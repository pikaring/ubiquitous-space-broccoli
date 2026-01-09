#pragma once
#include <stdint.h>

typedef struct {
    const char *name;
    uint64_t sprite;
} MonsterSprite;

extern const MonsterSprite monster_sprites[];
uint64_t get_monster_sprite(const char *name);
