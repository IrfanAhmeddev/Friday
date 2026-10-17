"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planResponse = planResponse;
const dialogue_manager_1 = require("./dialogue-manager");
function planResponse(input, state) {
    const normalized = input.trim();
    if (!normalized) {
        return {
            strategy: "unknown",
            message: "I’m not sure what you want me to do.",
            summary: "Empty input",
            requiresClarification: true,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    const lower = normalized.toLowerCase();
    if (/^(hi|hello|hey|good morning|good evening|good night)\b/.test(lower)) {
        return {
            strategy: "greeting",
            message: "Hi! How can I help you today?",
            summary: "Greeting",
            requiresClarification: false,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    if (state && state.pendingQuestions.length > 0) {
        const question = state.pendingQuestions[0];
        return {
            strategy: "clarify",
            message: question,
            summary: "Pending clarification",
            requiresClarification: true,
            contextSummary: (0, dialogue_manager_1.summarizeDialogueState)(state),
        };
    }
    if (/\b(what|why|how|when|which|who)\b/.test(lower)) {
        return {
            strategy: "answer",
            message: "I can help answer that, but I need a bit more context if it is a domain-specific question.",
            summary: "Answering a question",
            requiresClarification: false,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    if (/\b(explain|describe|tell me|show me)\b/.test(lower)) {
        return {
            strategy: "explain",
            message: "Here’s the relevant explanation, and I’ll keep the current context in mind.",
            summary: "Explanation requested",
            requiresClarification: false,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    if (/\b(actual|wait|no\b|not\b|instead)\b/.test(lower)) {
        return {
            strategy: "correction",
            message: "Got it — I’ll update the interpretation and preserve the rest of the request.",
            summary: "Correction received",
            requiresClarification: false,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    if (/\b(keep everything else|keep the original|keep the rest)\b/.test(lower)) {
        return {
            strategy: "continue",
            message: "Understood — I’ll keep the established constraints and only change what was requested.",
            summary: "Context preserved",
            requiresClarification: false,
            contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
        };
    }
    if (state && state.parameters.language) {
        return {
            strategy: "continue",
            message: `I have the current context: ${state.parameters.language}. I’ll keep that in mind unless you change it.`,
            summary: "Contextual continuation",
            requiresClarification: false,
            contextSummary: (0, dialogue_manager_1.summarizeDialogueState)(state),
        };
    }
    return {
        strategy: "acknowledge",
        message: "I understand the request and will keep the relevant context in mind.",
        summary: "Acknowledgement",
        requiresClarification: false,
        contextSummary: state ? (0, dialogue_manager_1.summarizeDialogueState)(state) : "no active context",
    };
}
