"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectConversationalSemantic = detectConversationalSemantic;
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^\w]/g, ""))
        .filter(Boolean);
}
function hasReference(tokens) {
    return tokens.some((token) => [
        "it",
        "that",
        "this",
        "one"
    ].includes(token));
}
function findEntity(entities, type) {
    return entities.find((entity) => entity.type === type);
}
function getPreviousObject(previousSemantic, previousEntities) {
    if (previousSemantic.object !== "unknown") {
        return previousSemantic.object;
    }
    const objectEntity = findEntity(previousEntities, "workspace_object");
    if (objectEntity) {
        return objectEntity.value;
    }
    return "unknown";
}
function detectConversationalSemantic(text, previousSemantic, previousEntities = []) {
    const tokens = tokenize(text);
    if (!previousSemantic) {
        return {
            action: "unknown",
            object: "unknown",
            confidence: 0,
            matchedWords: [],
            derivedFromConversation: false
        };
    }
    if (!hasReference(tokens)) {
        return {
            action: "unknown",
            object: "unknown",
            confidence: 0,
            matchedWords: [],
            derivedFromConversation: false
        };
    }
    const object = getPreviousObject(previousSemantic, previousEntities);
    if (object === "unknown") {
        return {
            action: "unknown",
            object: "unknown",
            confidence: 0.40,
            matchedWords: [],
            derivedFromConversation: true
        };
    }
    const hasCall = tokens.includes("call");
    const hasRename = tokens.includes("rename");
    const hasChange = tokens.includes("change");
    const hasName = tokens.includes("name");
    const hasOpen = tokens.includes("open");
    const hasShow = tokens.includes("show") ||
        tokens.includes("display") ||
        tokens.includes("view");
    const hasDelete = tokens.includes("delete") ||
        tokens.includes("erase");
    const hasRemove = tokens.includes("remove");
    const hasClose = tokens.includes("close") ||
        tokens.includes("exit");
    const hasTo = tokens.includes("to");
    let action = "unknown";
    if (hasCall ||
        hasRename ||
        (hasChange && hasName)) {
        action = "rename";
    }
    else if (hasOpen) {
        action = "open";
    }
    else if (hasShow) {
        action = "show";
    }
    else if (hasDelete) {
        action = "delete";
    }
    else if (hasRemove) {
        action = "remove";
    }
    else if (hasClose) {
        action = "close";
    }
    if (action === "unknown") {
        return {
            action: "unknown",
            object,
            confidence: 0,
            matchedWords: [],
            derivedFromConversation: false
        };
    }
    const matchedWords = tokens.filter((token) => [
        "call",
        "rename",
        "change",
        "name",
        "open",
        "show",
        "display",
        "view",
        "delete",
        "erase",
        "remove",
        "close",
        "exit",
        "to",
        "it",
        "that",
        "this",
        "one"
    ].includes(token));
    let confidence = 0.75;
    if (hasReference(tokens)) {
        confidence += 0.05;
    }
    if (action === "rename" &&
        (hasCall || hasRename)) {
        confidence += 0.10;
    }
    if (hasTo) {
        confidence += 0.05;
    }
    return {
        action,
        object,
        confidence: Math.min(Number(confidence.toFixed(3)), 0.95),
        matchedWords,
        derivedFromConversation: true
    };
}
