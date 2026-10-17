import {
  Entity,
  SemanticResult,
} from "../types/nlu";
import type { DialogueMemory } from "./dialogue-manager";

export interface ConversationTurn {
  input: string;
  semantic: SemanticResult;
  entities: Entity[];
}

export interface ConversationState {
  sessionId: string;
  history: ConversationTurn[];
  dialogue?: DialogueMemory;
}

const MAX_HISTORY = 10;
const MAX_SESSIONS = 1_000;

const sessions = new Map<string, ConversationState>();

export function getOrCreateSession(
  sessionId: string,
): ConversationState {
  const existing = sessions.get(sessionId);

  if (existing) {
    sessions.delete(sessionId);
    sessions.set(sessionId, existing);
    return existing;
  }

  const state: ConversationState = {
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

function isMeaningfulTurn(
  turn: ConversationTurn,
): boolean {
  const hasKnownAction =
    turn.semantic.action !== "unknown";

  const hasKnownObject =
    turn.semantic.object !== "unknown";

  const hasUsefulEntity =
    turn.entities.some(
      (entity) =>
        entity.type === "name" ||
        entity.type === "new_name" ||
        entity.type === "target_name" ||
        entity.type === "workspace_object",
    );

  return (
    hasKnownAction ||
    hasKnownObject ||
    hasUsefulEntity
  );
}

export function addTurn(
  sessionId: string,
  turn: ConversationTurn,
): ConversationState {
  const state = getOrCreateSession(sessionId);

  if (isMeaningfulTurn(turn)) {
    state.history.push(turn);

    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
  }

  return state;
}

export function getLastTurn(
  sessionId: string,
): ConversationTurn | undefined {
  const state = sessions.get(sessionId);

  if (!state || state.history.length === 0) {
    return undefined;
  }

  return state.history[state.history.length - 1];
}

export function getLastMeaningfulTurn(
  sessionId: string,
): ConversationTurn | undefined {
  return getLastTurn(sessionId);
}

export function getHistory(
  sessionId: string,
): ConversationTurn[] {
  const state = sessions.get(sessionId);

  if (!state) {
    return [];
  }

  return [...state.history];
}

export function clearSession(
  sessionId: string,
): void {
  sessions.delete(sessionId);
}