// Compile parser states to numeric literals in both module formats.
export const enum State {
    VALUE = 1,
    OBJ_FIRST = 2,
    OBJ_KEY = 3,
    COLON = 4,
    OBJ_NEXT = 5,
    ARR_NEXT = 6,
    STR = 7,
    ESC = 8,
    UESC = 9,
    NUM = 10,
    LIT = 11,
    END = 12,
    FAILED = 13,
    SKIP = 14,
    IDENT = 15,
    SKIP_LF = 16,
}
