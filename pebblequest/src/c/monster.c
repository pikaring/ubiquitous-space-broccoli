#include <pebble.h>
#include "battle_logic.h"

// モンスターの基本データ（全10種）
Monster enemy_pool[] = {
    // 初期エリア向け
    {"SLIME",    {{PA, 5, false}, {GU, 3, false}, {CHOKI, 4, false}}, 15},
    {"BAT",      {{CHOKI, 4, false}, {PA, 3, false}, {GU, 2, false}}, 12},
    {"GOBLIN",   {{GU, 6, false}, {GU, 2, false}, {CHOKI, 5, false}}, 20},

    // 中盤
    {"SKELETON", {{PA, 6, false}, {CHOKI, 6, false}, {GU, 3, false}}, 22},
    {"ORC",      {{GU, 8, false}, {PA, 5, false}, {CHOKI, 4, false}}, 30},
    {"GHOST",    {{CHOKI, 7, false}, {PA, 4, false}, {GU, 4, false}}, 18},

    // 上位
    {"WIZARD",   {{PA, 8, false}, {PA, 1, false}, {CHOKI, 3, false}}, 12},
    {"KNIGHT",   {{PA, 7, false}, {GU, 7, false}, {CHOKI, 5, false}}, 28},
    {"DEMON",    {{GU, 9, false}, {PA, 6, false}, {CHOKI, 6, false}}, 35},

    // ボス級
    {"DRAGON",   {{PA,10, false}, {GU, 8, false}, {CHOKI, 7, false}}, 45}
};

#define ENEMY_COUNT (sizeof(enemy_pool) / sizeof(enemy_pool[0]))

Monster get_random_monster() {
    return enemy_pool[rand() % ENEMY_COUNT];
}
