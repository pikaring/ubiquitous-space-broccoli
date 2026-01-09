#pragma once
#include <pebble.h>

// ダンジョンサイズ（dungeon_create.hと合わせる）
#define CELL_PATH 0
#define CELL_WALL 1

typedef enum { GU = 0, CHOKI = 1, PA = 2 } Hand;

// ゲーム全体の状態（重複しないように統合）
typedef enum {
  STATE_TITLE,          // 追加
  STATE_EXPLORE,
  STATE_ENCOUNTER,
  STATE_BATTLE_START,
  STATE_ENEMY_SELECT,
  STATE_PLAYER_SELECT,
  STATE_BATTLE_ANIM,
  STATE_RESULT,
  STATE_WIN,
  STATE_CLEAR           // 追加
} GameState;

typedef struct {
    Hand hand;
    int value;
    bool is_used;
} Card;

typedef struct {
    char name[16];
    Card cards[3];
    int hp;
} Monster;

// プレイヤー構造体の定義
typedef struct { 
    int x; 
    int y; 
    int dir; 
    int hp; 
    int floor; 
} Player;