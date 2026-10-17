"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDialogueMemory = createDialogueMemory;
exports.summarizeDialogueState = summarizeDialogueState;
exports.resolveContextualReference = resolveContextualReference;
exports.processDialogueTurn = processDialogueTurn;
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}
function coerceString(value) {
    return typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : null;
}
function detectLanguage(text) {
    const lc = normalizeText(text);
    const matches = [
        "typescript",
        "javascript",
        "python",
        "go",
        "rust",
        "java",
        "c#",
        "c++",
        "html",
        "css",
        "sql",
    ];
    for (const candidate of matches) {
        if (lc.includes(candidate)) {
            return candidate;
        }
    }
    return null;
}
function detectConstraint(text) {
    const lc = normalizeText(text);
    const constraints = [
        "lightweight",
        "small",
        "smaller",
        "faster",
        "minimal",
        "responsive",
        "modern",
        "simple",
    ];
    for (const constraint of constraints) {
        if (lc.includes(constraint)) {
            return constraint;
        }
    }
    return null;
}
function createDialogueMemory(sessionId) {
    return {
        sessionId,
        activeTopic: null,
        taskType: null,
        parameters: {},
        constraints: [],
        pendingQuestions: [],
        lastDialogueAct: "unknown",
        lastUtterance: null,
    };
}
function summarizeDialogueState(state) {
    const details = [];
    if (state.activeTopic) {
        details.push(`topic: ${state.activeTopic}`);
    }
    if (state.taskType) {
        details.push(`task: ${state.taskType}`);
    }
    if (Object.keys(state.parameters).length > 0) {
        details.push(`parameters: ${Object.entries(state.parameters)
            .map(([key, value]) => `${key}=${value}`)
            .join(", ")}`);
    }
    if (state.constraints.length > 0) {
        details.push(`constraints: ${state.constraints.join(", ")}`);
    }
    if (state.pendingQuestions.length > 0) {
        details.push(`pending: ${state.pendingQuestions.join("; ")}`);
    }
    return details.length > 0
        ? details.join(" | ")
        : "no active context";
}
function resolveContextualReference(state, text) {
    const normalized = normalizeText(text);
    const references = [
        "it",
        "that",
        "this",
        "this one",
        "the other one",
        "the previous file",
        "the same project",
        "keep everything else",
        "keep the original",
    ];
    for (const reference of references) {
        if (normalized.includes(reference)) {
            return {
                reference,
                matchedValue: reference,
            };
        }
    }
    if (state.activeTopic) {
        return {
            reference: "previous topic",
            matchedValue: state.activeTopic,
        };
    }
    return {
        reference: null,
        matchedValue: null,
    };
}
function processDialogueTurn(state, input, interpretation = {}) {
    const messages = coerceString(input);
    if (!messages) {
        return {
            state,
            dialogueAct: "unknown",
            clarification: null,
            summary: summarizeDialogueState(state),
        };
    }
    const nextState = {
        ...state,
        lastUtterance: messages,
        pendingQuestions: [...state.pendingQuestions],
        parameters: { ...state.parameters },
        constraints: [...state.constraints],
    };
    const normalized = normalizeText(messages);
    const action = interpretation.semantic?.action ?? null;
    const object = interpretation.semantic?.object ?? null;
    const intentName = interpretation.intent ?? null;
    if (/(^|\s)(hi|hello|hey|good morning|good evening|good night)/.test(normalized)) {
        nextState.lastDialogueAct = "greeting";
        return {
            state: nextState,
            dialogueAct: "greeting",
            clarification: null,
            summary: "Greeting acknowledged.",
        };
    }
    if (/(^|\s)(thanks|thank you|see you later)/.test(normalized)) {
        nextState.lastDialogueAct = "acknowledge";
        return {
            state: nextState,
            dialogueAct: "acknowledge",
            clarification: null,
            summary: "Appreciation acknowledged.",
        };
    }
    if (/\b(create|build|make)\b.*\b(framework|project)\b|\bframework\b/.test(normalized)) {
        nextState.activeTopic = "framework";
        nextState.taskType = "create";
        nextState.lastDialogueAct = "request";
        if (!nextState.parameters.language) {
            nextState.pendingQuestions = [
                "Which language would you like to use?",
            ];
            return {
                state: nextState,
                dialogueAct: "clarify",
                clarification: "Which language would you like to use?",
                summary: "Framework task identified; awaiting language selection.",
            };
        }
        return {
            state: nextState,
            dialogueAct: "request",
            clarification: null,
            summary: "Framework task remains active with language selected.",
        };
    }
    if (/(^|\s)(actually|wait|no|not|instead|use\s+.*\s+instead)/.test(normalized)) {
        nextState.lastDialogueAct = "correction";
        const replacementLanguage = detectLanguage(normalized);
        if (replacementLanguage) {
            nextState.parameters.language = replacementLanguage;
            nextState.pendingQuestions = nextState.pendingQuestions.filter((question) => !question.toLowerCase().includes("language"));
        }
        return {
            state: nextState,
            dialogueAct: "correction",
            clarification: null,
            summary: "Correction processed while preserving the remaining constraints.",
        };
    }
    const language = detectLanguage(normalized);
    if (language) {
        nextState.parameters.language = language;
        nextState.pendingQuestions = nextState.pendingQuestions.filter((question) => !question.toLowerCase().includes("language"));
        nextState.lastDialogueAct = "continue";
        return {
            state: nextState,
            dialogueAct: "continue",
            clarification: null,
            summary: `Language set to ${language}.`,
        };
    }
    const constraint = detectConstraint(normalized);
    if (constraint) {
        if (!nextState.constraints.includes(constraint)) {
            nextState.constraints.push(constraint);
        }
        nextState.lastDialogueAct = "continue";
        return {
            state: nextState,
            dialogueAct: "continue",
            clarification: null,
            summary: `Constraint preserved: ${constraint}.`,
        };
    }
    if (/\b(keep everything else|keep the original|keep the rest)\b/.test(normalized)) {
        nextState.lastDialogueAct = "continue";
        return {
            state: nextState,
            dialogueAct: "continue",
            clarification: null,
            summary: "The existing requirements were preserved.",
        };
    }
    const hasQuestion = /\b(what|why|how|when|which|who)\b/.test(normalized);
    if (hasQuestion) {
        nextState.lastDialogueAct = "question";
        return {
            state: nextState,
            dialogueAct: "question",
            clarification: null,
            summary: "The user is asking a question and needs a direct answer.",
        };
    }
    if (/(^|\s)(explain|describe|tell me|show me)/.test(normalized)) {
        nextState.lastDialogueAct = "explain";
        return {
            state: nextState,
            dialogueAct: "explain",
            clarification: null,
            summary: "Explanatory response selected.",
        };
    }
    if (action || object || intentName) {
        nextState.lastDialogueAct = "request";
        return {
            state: nextState,
            dialogueAct: "request",
            clarification: null,
            summary: `Interpretation accepted for ${intentName ?? action ?? object ?? "request"}.`,
        };
    }
    nextState.lastDialogueAct = "acknowledge";
    return {
        state: nextState,
        dialogueAct: "acknowledge",
        clarification: null,
        summary: "Message received and stored in session context.",
    };
}
