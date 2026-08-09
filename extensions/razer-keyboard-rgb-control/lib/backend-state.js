export function didKeyboardBecomeAvailable(previousState = {}, nextState = {}) {
    const previousKeyboard = previousState?.keyboard ?? null;
    const nextKeyboard = nextState?.keyboard ?? null;

    return Boolean(nextKeyboard) && (
        !previousKeyboard ||
        previousKeyboard.serial !== nextKeyboard.serial
    );
}
