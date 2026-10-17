"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
function normalizeText(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
