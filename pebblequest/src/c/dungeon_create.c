#include <pebble.h>
#include "dungeon_create.h"

// スタック用の構造体と変数
typedef struct {
    int x;
    int y;
} Cell;

static Cell s_wall_stack[DUNGEON_W * DUNGEON_H];
static int s_stack_ptr = 0;

static void stack_push(int x, int y) {
    s_wall_stack[s_stack_ptr].x = x;
    s_wall_stack[s_stack_ptr].y = y;
    s_stack_ptr++;
}

static Cell stack_pop() {
    s_stack_ptr--;
    return s_wall_stack[s_stack_ptr];
}

// 拡張中の壁（自分自身）に含まれているか判定
static bool is_current_wall(uint8_t dungeon[DUNGEON_H][DUNGEON_W], int x, int y) {
    for (int i = 0; i < s_stack_ptr; i++) {
        if (s_wall_stack[i].x == x && s_wall_stack[i].y == y) return true;
    }
    return false;
}

// 1つの点から壁を伸ばす再帰関数
static void extend_wall(uint8_t dungeon[DUNGEON_H][DUNGEON_W], int x, int y) {
    int dirs[4] = {0, 1, 2, 3};
    // シャッフル
    for (int i = 0; i < 4; i++) {
        int r = rand() % 4;
        int tmp = dirs[i]; dirs[i] = dirs[r]; dirs[r] = tmp;
    }

    bool extended = false;
    for (int i = 0; i < 4; i++) {
        int dx = (dirs[i] == 1) ? 1 : (dirs[i] == 3) ? -1 : 0;
        int dy = (dirs[i] == 2) ? 1 : (dirs[i] == 0) ? -1 : 0;
        int tx = x + dx * 2;
        int ty = y + dy * 2;

        // 範囲内かつ、伸ばす先が通路で、かつ自分自身の壁にぶつからないか
        if (tx > 0 && tx < DUNGEON_W - 1 && ty > 0 && ty < DUNGEON_H - 1) {
            if (!is_current_wall(dungeon, tx, ty)) {
                if (dungeon[ty][tx] == CELL_PATH) {
                    // 通路なら壁を置いてさらに伸ばす
                    dungeon[y + dy][x + dx] = CELL_WALL;
                    dungeon[ty][tx] = CELL_WALL;
                    stack_push(tx, ty);
                    extend_wall(dungeon, tx, ty);
                    extended = true;
                    break;
                } else {
                    // 既存の壁に接続した
                    dungeon[y + dy][x + dx] = CELL_WALL;
                    dungeon[ty][tx] = CELL_WALL;
                    extended = true;
                    break;
                }
            }
        }
    }

    // どこにも伸ばせなかったらバックトラック
    if (!extended && s_stack_ptr > 0) {
        Cell prev = stack_pop();
        extend_wall(dungeon, prev.x, prev.y);
    }
}

void dungeon_create(uint8_t dungeon[DUNGEON_H][DUNGEON_W]) {
    // 1. 初期化
    for (int y = 0; y < DUNGEON_H; y++) {
        for (int x = 0; x < DUNGEON_W; x++) {
            if (x == 0 || y == 0 || x == DUNGEON_W - 1 || y == DUNGEON_H - 1) {
                dungeon[y][x] = CELL_WALL;
            } else {
                dungeon[y][x] = CELL_PATH;
            }
        }
    }

    // 2. 壁伸ばし開始点のリスト（偶数座標）
    for (int y = 2; y < DUNGEON_H - 2; y += 2) {
        for (int x = 2; x < DUNGEON_W - 2; x += 2) {
            if (dungeon[y][x] == CELL_PATH) {
                s_stack_ptr = 0;
                stack_push(x, y);
                extend_wall(dungeon, x, y);
            }
        }
    }
}