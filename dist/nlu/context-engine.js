"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateSession = getOrCreateSession;
exports.addTurn = addTurn;
exports.getLastTurn = getLastTurn;
exports.getLastMeaningfulTurn = getLastMeaningfulTurn;
exports.getHistory = getHistory;
exports.clearSession = clearSession;
const MAX_HISTORY = 10;
const MAX_SESSIONS = 1_000;
const sessions = new Map();
function getOrCreateSession(sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) {
        sessions.delete(sessionId);
        sessions.set(sessionId, existing);
        return existing;
    }
    const state = {
        sessionId,
        history: [],
        dialogue: {
            sessionId,
            activeTopic: null,
            taskType: null,
            parameters: {},
            constraints: [],
            pendingQuestions: [],
            lastDialogueAct: "unknown",
            lastUtterance: null,
        },
    };
    if (sessions.size >= MAX_SESSIONS) {
        const leastRecentlyUsed = sessions.keys().next().value;
        if (leastRecentlyUsed !== undefined) {
            sessions.delete(leastRecentlyUsed);
        }
    }
    sessions.set(sessionId, state);
    return state;
}
function isMeaningfulTurn(turn) {
    const hasKnownAction = turn.semantic.action !== "unknown";
    const hasKnownObject = turn.semantic.object !== "unknown";
    const hasUsefulEntity = turn.entities.some((entity) => entity.type === "name" ||
        entity.type === "new_name" ||
        entity.type === "target_name" ||
        entity.type === "workspace_object");
    return (hasKnownAction ||
        hasKnownObject ||
        hasUsefulEntity);
}
function addTurn(sessionId, turn) {
    const state = getOrCreateSession(sessionId);
    if (isMeaningfulTurn(turn)) {
        state.history.push(turn);
        if (state.history.length > MAX_HISTORY) {
            state.history.shift();
        }
    }
    return state;
}
function getLastTurn(sessionId) {
    const state = sessions.get(sessionId);
    if (!state || state.history.length === 0) {
        return undefined;
    }
    return state.history[state.history.length - 1];
}
function getLastMeaningfulTurn(sessionId) {
    return getLastTurn(sessionId);
}
function getHistory(sessionId) {
    const state = sessions.get(sessionId);
    if (!state) {
        return [];
    }
    return [...state.history];
}
function clearSession(sessionId) {
    sessions.delete(sessionId);
}
